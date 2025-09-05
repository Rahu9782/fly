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
# ## THE FINAL UNIFIED NOTAM DECODER CLASS (UPDATED)
# ############################################################################

class NotamDecoder:
    """
    A comprehensive NOTAM decoder that parses raw text and translates it into
    a structured AIRlang rule. It uses a hybrid regex/NLP approach to handle
    various NOTAM formats, including complex schedules and wrap-around weeks.
    """
    def __init__(self, notam_text):
        # ... (init is unchanged)
        self.raw_text = notam_text
        self.q_code_map = {'RD': 'DANGER', 'RA': 'RESTRICTED', 'RP': 'PROHIBITED'}
        self.notam_id, self.airport, self.q_code = None, None, None
        self.notam_type = "UNKNOWN"
        self.start_time, self.end_time = None, None
        self.schedule = {'type': 'CONTINUOUS', 'rules': {}}
        self.areas = []
        self.subject = {}
        self._decode()

    def _decode(self):
        # ... (orchestrator is unchanged)
        self._parse_header()
        self._determine_type()
        self._parse_schedule()
        self._parse_body()
    
    # --- Parsing Sub-Routines (Header, Type, Body router are unchanged) ---
    def _parse_header(self):
        # ... (unchanged)
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
        # ... (unchanged)
        if not self.q_code: return
        if self.q_code.startswith('QMR') or self.q_code.startswith('QFA'): self.notam_type = 'RUNWAY' # Grouping QFA with Runway
        elif self.q_code.startswith('QRT') or self.q_code.startswith('QRD') or self.q_code.startswith('QW'): self.notam_type = 'AREA'

    def _parse_body(self):
        # ... (unchanged)
        if self.notam_type == 'RUNWAY': self._parse_runway_details(self.raw_text)
        elif self.notam_type == 'AREA':
            e_match = re.search(r'E\)(.*?)(?=\n[F-Z]|\Z)', self.raw_text, re.DOTALL)
            e_content = e_match.group(1).strip() if e_match else ""
            self._parse_area_details(e_content)

    def _parse_schedule(self):
        # ... (unchanged schedule router)
        d_match = re.search(r'D\)(.*?)(?=\n[A-Z]\)|$)', self.raw_text, re.DOTALL)
        if d_match:
            content = d_match.group(1).strip()
            if any(day in content for day in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", "DAILY"]):
                self.schedule['type'] = 'WEEKLY' if "DAILY" not in content else "DAILY"
                self.schedule['rules'] = self._decode_weekly_schedule(content)
                return
        # ... (rest of function is the same)

    # ########################################################################
    # ## THIS IS THE CORRECTED WEEKLY SCHEDULE FUNCTION
    # ########################################################################
    def _decode_weekly_schedule(self, content):
        """
        CORRECTED: Handles both normal (MON-FRI) and wrap-around (SUN-THU)
        day-of-the-week ranges.
        """
        rules = {}
        days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        for line in content.split('\n'):
            line = line.strip()
            time_ranges = re.findall(r'(\d{4}-\d{4})', line)
            day_part = re.sub(r'\d{4}-\d{4}', '', line).strip()
            
            active_days = []
            # Priority 1: Check for day ranges (e.g., SUN-THU)
            range_match = re.search(r'([A-Z]{3})-([A-Z]{3})', day_part)
            if range_match:
                start_day, end_day = range_match.group(1), range_match.group(2)
                start_idx, end_idx = days.index(start_day), days.index(end_day)
                
                if start_idx <= end_idx: # Normal range like THU-SUN
                    active_days = days[start_idx : end_idx+1]
                else: # Wrap-around range like SUN-THU
                    active_days = days[start_idx:] + days[:end_idx+1]

            # Priority 2: Check for DAILY
            elif "DAILY" in day_part:
                active_days = days
            
            # Priority 3: Fallback to individual days (e.g., MON FRI)
            else:
                active_days = [d for d in days if d in day_part]
            
            for day in active_days:
                if day not in rules: rules[day] = []
                rules[day].extend(time_ranges)
        return rules
    
    # ########################################################################
    # ## THIS IS THE CORRECTED RUNWAY PARSING FUNCTION
    # ########################################################################
    def _parse_runway_details(self, text_content):
        """
        UPDATED: More robustly finds runway/aerodrome status. It first looks
        for a specific runway, then for "AD CLSD" (Aerodrome Closed).
        """
        # Case 1: Specific runway is mentioned
        rwy_match = re.search(r'RWY\s+(\d{2}/\d{2})', text_content)
        if rwy_match:
            self.subject['identifier'] = rwy_match.group(1)
            if "CLSD" in text_content:
                self.subject['status'] = "CLOSED"
            else:
                self.subject['status'] = "AFFECTED" # Fallback if no CLSD found
            return

        # Case 2: Aerodrome is closed (AD CLSD)
        ad_clsd_match = re.search(r'AD\s+CLSD', text_content)
        if ad_clsd_match:
            self.subject['identifier'] = "ALL RWYS"
            self.subject['status'] = "CLOSED"
            return
        
        # Case 3: Fallback for QFAAH where status might be implied
        if self.q_code and self.q_code.startswith('QFA'):
             self.subject['identifier'] = "" # No specific runway known
             self.subject['status'] = "AFFECTED"

    # --- Other decoders and formatters are unchanged ---
    def _decode_complex_date_schedule(self, content):
        # ... (unchanged)
        return {}
    def _decode_monthly_date_schedule(self, content):
        # ... (unchanged)
        return {}
    def _decode_multiline_specific_date_schedule(self, e_content):
        # ... (unchanged)
        return {}
    def _parse_area_details(self, e_content):
        # ... (unchanged)
        pass
    def format_airlang(self):
        # ... (unchanged)
        if self.notam_type == "UNKNOWN": return "Could not determine NOTAM type."
        timedef = self._format_timedef()
        maindef = ""
        if self.notam_type == 'RUNWAY': maindef = self._format_rwydef()
        elif self.notam_type == 'AREA': maindef = self._format_areadefs()
        return f"{timedef}\n\n{maindef}"
    def _format_timedef(self):
        # ... (unchanged)
        indent = ' ' * 20
        start_f = self.start_time.strftime('%d %b %Y %H:%M') if self.start_time else ''
        end_f = self.end_time.strftime('%d %b %Y %H:%M') if self.end_time else ''
        rules = self.schedule.get('rules', {})
        if self.schedule['type'] == 'WEEKLY':
            parts = []
            for day in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]:
                if day in rules:
                    for time_range in sorted(list(set(rules[day]))):
                        start_t, end_t = time_range.split('-')
                        parts.append(f"{day} {start_t[:2]}:{start_t[2:]} TO {day} {end_t[:2]}:{end_t[2:]}")
            schedule_str = f",\n{indent}".join(parts)
            return f"TIMEDEF DURATION = {start_f} TO {end_f}: ({schedule_str});"
        # ... (rest of function is the same)
        return "TIMEDEF DURATION = NOT PARSED;"
    def _format_rwydef(self):
        # ... (unchanged)
        ident = self.subject.get('identifier', '')
        status = self.subject.get('status', '')
        return f"RWYDEF {self.airport} {ident} {status} DURATION;"
    def _format_areadefs(self):
        # ... (unchanged)
        return ""

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
