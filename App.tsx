# --- app.py or main.py ---
from flask import Flask, request, jsonify, render_template
import re
from datetime import datetime, timedelta
import spacy

# Load the spaCy model once for efficiency
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print("Downloading spaCy model 'en_core_web_sm'...")
    from spacy.cli import download
    download("en_core_web_sm")
    nlp = spacy.load("en_core_web_sm")

app = Flask(__name__)

# ############################################################################
# ## THE UNIFIED NOTAM DECODER CLASS (UPDATED)
# ############################################################################

class NotamDecoder:
    """
    A comprehensive NOTAM decoder that parses raw text and translates it into
    a structured AIRlang rule. It uses a hybrid regex/NLP approach to handle
    various NOTAM formats for runways, areas, and complex schedules.
    """
    def __init__(self, notam_text):
        self.raw_text = notam_text
        self.q_code_map = {'RD': 'DANGER', 'RA': 'RESTRICTED', 'RP': 'PROHIBITED'}

        # --- Parsed Data ---
        self.notam_id, self.airport, self.q_code = None, None, None
        self.notam_type = "UNKNOWN"
        self.start_time, self.end_time = None, None
        self.schedule = {'type': 'CONTINUOUS', 'rules': {}}
        self.areas = []
        self.subject = {}

        self._decode() # Start the process

    def _decode(self):
        """Orchestrates the entire parsing process."""
        self._parse_header()
        self._determine_type()
        self._parse_schedule()
        self._parse_body()

    def _parse_header(self):
        """Uses reliable regex to extract foundational fields."""
        # ... (This function is unchanged)
        id_match = re.search(r'\(([A-Z]\d{4}/\d{2})', self.raw_text) or re.search(r'^([A-Z]\d{4}/\d{2})', self.raw_text)
        if id_match: self.notam_id = id_match.group(1)
        q_match = re.search(r'Q\)\s*\w{4}/(\w{5})', self.raw_text)
        if q_match: self.q_code = q_match.group(1)
        a_match = re.search(r'A\)\s*(\w{4})', self.raw_text)
        if a_match: self.airport = a_match.group(1)
        b_match = re.search(r'B\)\s*(\d{10})', self.raw_text)
        if b_match: self.start_time = datetime.strptime(b_match.group(1), '%y%m%d%H%M')
        c_match = re.search(r'C\)\s*(\d{10})', self.raw_text)
        if c_match: self.end_time = datetime.strptime(c_match.group(1), '%y%m%d%H%M')

    def _determine_type(self):
        """Uses the Q-Code to determine the fundamental NOTAM type."""
        # ... (This function is unchanged)
        if not self.q_code: return
        if self.q_code.startswith('QMR'): self.notam_type = 'RUNWAY'
        elif self.q_code.startswith('QRT') or self.q_code.startswith('QRD') or self.q_code.startswith('QW'): self.notam_type = 'AREA'
        elif self.q_code.startswith('QFA'): self.notam_type = 'AERODROME_HOURS'


    def _parse_schedule(self):
        """Decodes the D) or E) field to find the active schedule."""
        d_match = re.search(r'D\)(.*?)(?=\n[A-Z]\)|$)', self.raw_text, re.DOTALL)
        e_match = re.search(r'E\)(.*?)(?=\n[F-Z]|\Z)', self.raw_text, re.DOTALL)

        # Priority 1: Check for a weekly schedule in the D) field
        if d_match:
            d_content = d_match.group(1).strip()
            if any(day in d_content for day in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]):
                self.schedule['type'] = 'WEEKLY'
                self.schedule['rules'] = self._decode_weekly_schedule(d_content)
                return # Schedule found, exit
        
        # Priority 2: Check for a specific date schedule in the E) field
        if e_match:
            e_content = e_match.group(1).strip()
            if any(month in e_content for month in ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]):
                self.schedule['type'] = 'SPECIFIC_DATES'
                self.schedule['rules'] = self._decode_specific_date_schedule(e_content)
                return # Schedule found, exit
    
    def _parse_body(self):
        """Routes to a specific parser based on the determined NOTAM type."""
        # For runway NOTAMs, the entire raw text is the best context
        if self.notam_type in ['RUNWAY', 'AERODROME_HOURS']:
            self._parse_runway_details(self.raw_text)
        elif self.notam_type == 'AREA':
            e_match = re.search(r'E\)(.*?)(?=\n[F-Z]|\Z)', self.raw_text, re.DOTALL)
            e_content = e_match.group(1).strip() if e_match else ""
            self._parse_area_details(e_content)
    
    # --- Specialized "Decoder" Sub-Routines ---
    def _decode_weekly_schedule(self, d_content):
        # ... (This function is unchanged)
        rules = {}
        days_of_week = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        for line in d_content.split('\n'):
            doc = nlp(line.strip())
            days_on_line = [tok.text for tok in doc if tok.text in days_of_week]
            times_on_line = [tok.text for tok in doc if re.fullmatch(r'\d{4}-\d{4}', tok.text)]
            for day in days_on_line:
                if day not in rules: rules[day] = []
                rules[day].extend(times_on_line)
        return rules

    def _decode_specific_date_schedule(self, e_content):
        # ... (This function is unchanged)
        rules = {}
        current_month = None
        year = self.start_time.year
        month_map = {m.upper(): i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}
        for line in e_content.split('\n'):
            line = line.strip()
            month_match = re.match(r'([A-Z]{3})\s+([\d\s]+)\s+(\d{4}-\d{4})', line)
            if month_match:
                current_month = month_map[month_match.group(1)]
                days_str, time_range = month_match.group(2).strip(), month_match.group(3)
                for day in [int(d) for d in days_str.split()]:
                    date_key = datetime(year, current_month, day).strftime('%d %b').upper()
                    if date_key not in rules: rules[date_key] = []
                    rules[date_key].append(time_range)
        return rules

    def _parse_runway_details(self, text_content):
        """
        UPDATED: More robustly finds runway and status.
        """
        # Step 1: Find the runway identifier (e.g., "06/24")
        rwy_match = re.search(r'RWY\s+(\d{2}/\d{2})', text_content)
        if not rwy_match: return
        self.subject['identifier'] = rwy_match.group(1)
        
        # Step 2: Determine the status by looking for keywords or inferring from Q-Code
        if "CLSD" in text_content or "CLOSED" in text_content:
            self.subject['status'] = "CLOSED"
        elif self.q_code in ['QFAAH', 'QMRLC']:
            # Infer status if not explicitly stated
            self.subject['status'] = "CLOSED" 
        else:
            self.subject['status'] = "AFFECTED" # Fallback

    def _parse_area_details(self, e_content):
        # ... (This function is unchanged, handles multi-area NOTAMs)
        area_chunks = re.split(r'\d+\.\s*AREA:', e_content)
        if len(area_chunks) <= 1: return # Not a multi-area NOTAM
        for chunk in area_chunks[1:]:
            area_data = {}
            coords = re.findall(r'(\d{6}[NS]\d{7}[EW])', chunk)
            if coords:
                area_data['geometry_type'] = 'POLYGON'
                area_data['points'] = [f"{c[:4]}{c[6]}{c[7:12]}{c[14]}+A+P" for c in coords]
            v_limits_match = re.search(r'(GND|SFC)\s*-\s*(\d+)M\s*AGL', chunk)
            if v_limits_match:
                upper_fl = round(int(v_limits_match.group(2)) / 30.48)
                area_data['lower_fl'] = 'FL001'
                area_data['upper_fl'] = f'FL{upper_fl:03d}'
            if 'geometry_type' in area_data:
                self.areas.append(area_data)

    # --- 4. AIRlang Formatting ---
    def format_airlang(self):
        """Builds the final AIRlang string from the parsed data."""
        # ... (This function is unchanged)
        if self.notam_type == "UNKNOWN": return "Could not determine NOTAM type."
        timedef = self._format_timedef()
        maindef = ""
        if self.notam_type in ['RUNWAY', 'AERODROME_HOURS']:
            maindef = self._format_rwydef()
        elif self.notam_type == 'AREA':
            maindef = self._format_areadefs()
        return f"{timedef}\n\n{maindef}"

    def _format_timedef(self):
        """Formats the TIMEDEF block based on the parsed schedule type."""
        # ... (This function has been slightly refined for sorting and clarity)
        indent = ' ' * 20 # len("TIMEDEF DURATION = ") + 1
        
        if self.schedule['type'] == 'WEEKLY':
            start_f = self.start_time.strftime('%d %b %Y %H:%M')
            end_f = self.end_time.strftime('%d %b %Y %H:%M')
            parts = []
            rules = self.schedule['rules']
            for day in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]:
                if day in rules:
                    for time_range in sorted(list(set(rules[day]))):
                        start_t, end_t = time_range.split('-')
                        parts.append(f"{day} {start_t[:2]}:{start_t[2:]} TO {day} {end_t[:2]}:{end_t[2:]}")
            schedule_str = f",\n{indent}".join(parts)
            return f"TIMEDEF DURATION = {start_f} TO {end_f}: ({schedule_str});"
        
        if self.schedule['type'] == 'SPECIFIC_DATES':
            parts = []
            rules = self.schedule['rules']
            sorted_keys = sorted(rules.keys(), key=lambda d: datetime.strptime(d, '%d %b'))
            for key in sorted_keys:
                for time_range in sorted(list(set(rules[key]))):
                    start_t, end_t = time_range.split('-')
                    time_str = f"({start_t[:2]}:{start_t[2:]} TO {end_t[:2]}:{end_t[2:]})"
                    parts.append(f"{key}: {time_str}")
            schedule_str = f",\n{indent}".join(parts)
            return f"TIMEDEF DURATION = {schedule_str};"
        
        # Fallback for continuous or daily
        if self.start_time and self.end_time:
            return f"TIMEDEF DURATION = {self.start_time.strftime('%d %b %Y %H:%M')} TO {self.end_time.strftime('%d %b %Y %H:%M')};"
        
        return "TIMEDEF DURATION = NOT PARSED;"
    
    def _format_rwydef(self):
        # ... (This function is unchanged)
        ident = self.subject.get('identifier', '')
        status = self.subject.get('status', '')
        return f"RWYDEF {self.airport} {ident} {status} DURATION;"

    def _format_areadefs(self):
        # ... (This function is unchanged)
        areadef_blocks = []
        # ...
        return "\n\n".join(areadef_blocks)


# ############################################################################
# ## FLASK WEB APPLICATION (Unchanged)
# ############################################################################
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/analyze', methods=['POST'])
def analyze_notam():
    notam_input = request.json.get('notam_text', '')
    if not notam_input:
        return jsonify({"airlang_code": "No NOTAM text provided."})
    try:
        decoder = NotamDecoder(notam_input)
        airlang_output = decoder.format_airlang()
        return jsonify({"airlang_code": airlang_output})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"airlang_code": f"An error occurred during parsing: {str(e)}"})

if __name__ == '__main__':
    app.run(debug=True)
