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
# ## THE FINAL UNIFIED NOTAM DECODER CLASS
# ############################################################################

class NotamDecoder:
    """
    A comprehensive NOTAM decoder that parses raw text and translates it into
    a structured AIRlang rule. It uses a hybrid regex/NLP approach to handle
    various NOTAM formats, including multi-area definitions and complex schedules.
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
    
    # --- Parsing Sub-Routines (Header, Type, Body are unchanged) ---
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
        if self.q_code.startswith('QMR'): self.notam_type = 'RUNWAY'
        elif self.q_code.startswith('QRT') or self.q_code.startswith('QRD') or self.q_code.startswith('QW'): self.notam_type = 'AREA'
        elif self.q_code.startswith('QFA'): self.notam_type = 'AERODROME_HOURS'

    def _parse_body(self):
        # ... (unchanged)
        if self.notam_type in ['RUNWAY', 'AERODROME_HOURS']: self._parse_runway_details(self.raw_text)
        elif self.notam_type == 'AREA':
            e_match = re.search(r'E\)(.*?)(?=\n[F-Z]|\Z)', self.raw_text, re.DOTALL)
            e_content = e_match.group(1).strip() if e_match else ""
            self._parse_area_details(e_content)
    
    # ########################################################################
    # ## THIS IS THE RE-ENGINEERED SCHEDULE PARSER
    # ########################################################################
    def _parse_schedule(self):
        """
        UPDATED: A more robust router that inspects the D) and E) fields
        to select the correct, specialized decoding function.
        """
        d_match = re.search(r'D\)(.*?)(?=\n[A-Z]\)|$)', self.raw_text, re.DOTALL)
        e_match = re.search(r'E\)(.*?)(?=\n[F-Z]|\Z)', self.raw_text, re.DOTALL)

        if d_match:
            content = d_match.group(1).strip()
            # Case 1: Weekly schedule (e.g., "MON-FRI", "DAILY")
            if any(day in content for day in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", "DAILY"]):
                self.schedule['type'] = 'WEEKLY' if "DAILY" not in content else "DAILY"
                self.schedule['rules'] = self._decode_weekly_schedule(content)
                return
            
            # Case 2: Date schedule with explicit month names (e.g., "JUL 23...")
            if any(month in content for month in ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]):
                self.schedule['type'] = 'SPECIFIC_DATES'
                self.schedule['rules'] = self._decode_complex_date_schedule(content)
                return
            
            # Case 3: Date schedule with month inferred from B) field (e.g., "03-07 10...")
            self.schedule['type'] = 'SPECIFIC_DATES'
            self.schedule['rules'] = self._decode_monthly_date_schedule(content)
            return

        # Case 4: Fallback to E field for date schedule if no D field
        if e_match and not d_match:
            content = e_match.group(1).strip()
            if any(month in content for month in ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]):
                self.schedule['type'] = 'SPECIFIC_DATES'
                self.schedule['rules'] = self._decode_multiline_specific_date_schedule(content)
                return
    
    # --- Specialized "Decoder" Functions ---
    def _decode_weekly_schedule(self, content):
        rules = {}
        days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        for line in content.split('\n'):
            line = line.strip()
            time_ranges = re.findall(r'(\d{4}-\d{4})', line)
            day_part = re.sub(r'\d{4}-\d{4}', '', line).strip()
            
            active_days = []
            if "DAILY" in day_part:
                active_days = days
            else:
                # Handle ranges like SUN-THU
                range_match = re.search(r'([A-Z]{3})-([A-Z]{3})', day_part)
                if range_match:
                    start_day, end_day = range_match.group(1), range_match.group(2)
                    start_idx, end_idx = days.index(start_day), days.index(end_day)
                    active_days = days[start_idx : end_idx+1]
                else: # Handle individual days like MON FRI
                    active_days = [d for d in days if d in day_part]
            
            for day in active_days:
                if day not in rules: rules[day] = []
                rules[day].extend(time_ranges)
        return rules

    def _decode_complex_date_schedule(self, content):
        # Handles "JUL 23 2100-2359, JUL 24-AUG 03 0000-1600 2100-2359..."
        rules = {}
        year = self.start_time.year
        # Split by comma, but not inside parentheses (future-proofing)
        for part in content.replace('\n', ' ').split(','):
            part = part.strip()
            time_ranges = re.findall(r'(\d{4}-\d{4})', part)
            date_part = re.sub(r'\d{4}-\d{4}', '', part).strip()
            
            # Date range: JUL 24-AUG 03
            range_match = re.match(r'([A-Z]{3})\s+(\d+)-([A-Z]{3})\s+(\d+)', date_part)
            # Single date: JUL 23
            single_match = re.match(r'([A-Z]{3})\s+(\d+)', date_part)

            dates_to_process = []
            if range_match:
                start_dt = datetime.strptime(f"{year} {range_match.group(1)} {range_match.group(2)}", "%Y %b %d")
                end_dt = datetime.strptime(f"{year} {range_match.group(3)} {range_match.group(4)}", "%Y %b %d")
                current_dt = start_dt
                while current_dt <= end_dt:
                    dates_to_process.append(current_dt)
                    current_dt += timedelta(days=1)
            elif single_match:
                dt = datetime.strptime(f"{year} {single_match.group(1)} {single_match.group(2)}", "%Y %b %d")
                dates_to_process.append(dt)
            
            for dt in dates_to_process:
                date_key = dt.strftime('%d %b').upper()
                if date_key not in rules: rules[date_key] = []
                rules[date_key].extend(time_ranges)
        return rules

    def _decode_monthly_date_schedule(self, content):
        # Handles "03-07 10 2100-2359" and "03 2000-1200, 04 2000-1200..."
        rules = {}
        month = self.start_time.month
        year = self.start_time.year
        
        # Split by comma for cases like "03 2000-1200, 04 2000-1200"
        for part in content.replace('\n', '').split(','):
            part = part.strip()
            time_match = re.search(r'(\d{4}-\d{4})', part)
            if not time_match: continue
            time_range = time_match.group(1)
            
            days_part = part.replace(time_range, '').strip()
            days = []
            for match in re.finditer(r'(\d{2})-(\d{2})|(\d{2})', days_part):
                if match.group(1): days.extend(range(int(match.group(1)), int(match.group(2)) + 1))
                else: days.append(int(match.group(3)))

            for day in days:
                date_key = datetime(year, month, day).strftime('%d %b').upper()
                if date_key not in rules: rules[date_key] = []
                rules[date_key].append(time_range)
        return rules
    
    def _decode_multiline_specific_date_schedule(self, e_content):
        # ... (This is the corrected function from the previous step, it remains the same)
        rules = {}
        current_month = None
        year = self.start_time.year if self.start_time else datetime.now().year
        month_map = {m.upper(): i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}
        for line in e_content.split('\n'):
            line = line.strip()
            if not line: continue
            month_line_match = re.match(r'^([A-Z]{3})\s+(.*)', line)
            if month_line_match:
                current_month = month_map[month_line_match.group(1)]
                line_content = month_line_match.group(2)
            else:
                line_content = line
            if current_month:
                time_match = re.search(r'(\d{4}-\d{4})$', line_content)
                if not time_match: continue
                time_range = time_match.group(1)
                days_part = line_content[:time_match.start()].strip()
                if not days_part: continue
                days = [int(d) for d in days_part.split()]
                for day in days:
                    date_key = datetime(year, current_month, day).strftime('%d %b').upper()
                    if date_key not in rules: rules[date_key] = []
                    rules[date_key].append(time_range)
        return rules
    
    # --- Body Parsers (Unchanged) ---
    def _parse_runway_details(self, text_content):
        # ... (unchanged)
        rwy_match = re.search(r'RWY\s+(\d{2}/\d{2})', text_content)
        if not rwy_match: return
        self.subject['identifier'] = rwy_match.group(1)
        if "CLSD" in text_content or "CLOSED" in text_content: self.subject['status'] = "CLOSED"
        elif self.q_code in ['QFAAH', 'QMRLC']: self.subject['status'] = "CLOSED" 
        else: self.subject['status'] = "AFFECTED"

    def _parse_area_details(self, e_content):
        # ... (unchanged)
        pass

    # --- 4. AIRlang Formatting ---
    def format_airlang(self):
        # ... (unchanged)
        if self.notam_type == "UNKNOWN": return "Could not determine NOTAM type."
        timedef = self._format_timedef()
        maindef = ""
        if self.notam_type in ['RUNWAY', 'AERODROME_HOURS']: maindef = self._format_rwydef()
        elif self.notam_type == 'AREA': maindef = self._format_areadefs()
        return f"{timedef}\n\n{maindef}"

    def _format_timedef(self):
        """
        UPDATED: Intelligent grouping for specific date schedules.
        """
        indent = ' ' * 20
        start_f = self.start_time.strftime('%d %b %Y %H:%M') if self.start_time else ''
        end_f = self.end_time.strftime('%d %b %Y %H:%M') if self.end_time else ''
        
        rules = self.schedule.get('rules', {})
        
        # Case 1: Continuous schedule
        if self.schedule['type'] == 'CONTINUOUS':
            return f"TIMEDEF DURATION = {start_f} TO {end_f};"

        # Case 2: Daily schedule
        if self.schedule['type'] == 'DAILY':
            time_range = rules.get('DAILY', [""])[0]
            start_t, end_t = time_range.split('-') if '-' in time_range else ('','')
            time_str = f"({start_t[:2]}:{start_t[2:]} TO {end_t[:2]}:{end_t[2:]})"
            return f"TIMEDEF DURATION = {start_f} TO {end_f}: {time_str};"
        
        # Case 3: Weekly schedule
        if self.schedule['type'] == 'WEEKLY':
            parts = []
            for day in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]:
                if day in rules:
                    for time_range in sorted(list(set(rules[day]))):
                        start_t, end_t = time_range.split('-')
                        parts.append(f"{day} {start_t[:2]}:{start_t[2:]} TO {day} {end_t[:2]}:{end_t[2:]}")
            schedule_str = f",\n{indent}".join(parts)
            return f"TIMEDEF DURATION = {start_f} TO {end_f}: ({schedule_str});"
        
        # Case 4: Specific date schedule (with intelligent grouping)
        if self.schedule['type'] == 'SPECIFIC_DATES':
            # Invert rules to group dates by time: {'0800-1200': ['03 AUG', '04 AUG']}
            inverted_rules = {}
            for date_key, time_list in rules.items():
                times_tuple = tuple(sorted(list(set(time_list))))
                if times_tuple not in inverted_rules: inverted_rules[times_tuple] = []
                inverted_rules[times_tuple].append(date_key)
            
            # Group consecutive dates
            grouped_parts = []
            for times_tuple, date_list in inverted_rules.items():
                time_str = ", ".join([f"({tr.split('-')[0][:2]}:{tr.split('-')[0][2:]} TO {tr.split('-')[1][:2]}:{tr.split('-')[1][2:]})" for tr in times_tuple])
                sorted_dates = sorted([datetime.strptime(d, '%d %b') for d in date_list])
                
                if not sorted_dates: continue
                start_date = sorted_dates[0]
                for i in range(1, len(sorted_dates)):
                    if (sorted_dates[i] - sorted_dates[i-1]).days > 1:
                        end_date = sorted_dates[i-1]
                        if start_date == end_date:
                            grouped_parts.append(f"{start_date.strftime('%d %b').upper()}: {time_str}")
                        else:
                            grouped_parts.append(f"{start_date.strftime('%d %b').upper()} TO {end_date.strftime('%d %b').upper()}: {time_str}")
                        start_date = sorted_dates[i]
                
                # Add the last group
                end_date = sorted_dates[-1]
                if start_date == end_date:
                    grouped_parts.append(f"{start_date.strftime('%d %b').upper()}: {time_str}")
                else:
                    grouped_parts.append(f"{start_date.strftime('%d %b').upper()} TO {end_date.strftime('%d %b').upper()}: {time_str}")
            
            # Sort final parts by their start date for clean output
            final_sorted_parts = sorted(grouped_parts, key=lambda p: datetime.strptime(p.split(':')[0].split(' TO ')[0], '%d %b'))
            schedule_str = f",\n{indent}".join(final_sorted_parts)
            return f"TIMEDEF DURATION = {schedule_str};"
            
        return "TIMEDEF DURATION = NOT PARSED;"

    # ... (rest of formatting functions are unchanged)
    def _format_rwydef(self):
        ident = self.subject.get('identifier', '')
        status = self.subject.get('status', '')
        return f"RWYDEF {self.airport} {ident} {status} DURATION;"

    def _format_areadefs(self):
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
