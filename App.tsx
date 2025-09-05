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
    various NOTAM formats, including multi-area definitions.
    """
    def __init__(self, notam_text):
        # --- Raw Data & Lookups ---
        self.raw_text = notam_text
        self.q_code_map = {'RD': 'DANGER', 'RA': 'RESTRICTED', 'RP': 'PROHIBITED'}

        # --- Parsed Header & Core Info ---
        self.notam_id = None
        self.airport = None
        self.q_code = None
        self.notam_type = "UNKNOWN"
        self.start_time = None
        self.end_time = None

        # --- Parsed Body Details ---
        self.schedule = {'type': 'CONTINUOUS', 'rules': {}}
        self.areas = [] # Changed to a list to support multiple areas
        self.subject = {}
        self.details = ""

        self._decode() # Begin the process automatically

    # --- 1. Main Decoding Orchestrator ---
    def _decode(self):
        """Orchestrates the entire parsing process."""
        self._parse_header()
        self._determine_type()
        self._parse_schedule()
        self._parse_body()

    # --- 2. Parsing Sub-Routines ---
    def _parse_header(self):
        """Uses reliable regex to extract foundational fields."""
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
        if not self.q_code: return
        if self.q_code.startswith('QMR'): self.notam_type = 'RUNWAY'
        elif self.q_code.startswith('QRT') or self.q_code.startswith('QRD') or self.q_code.startswith('QW'): self.notam_type = 'AREA'
        elif self.q_code.startswith('QFA'): self.notam_type = 'AERODROME_HOURS'

    def _parse_schedule(self):
        """Decodes the D) or E) field to understand the active schedule."""
        d_match = re.search(r'D\)(.*?)(?=\n[A-Z]\)|$)', self.raw_text, re.DOTALL)
        e_match = re.search(r'E\)(.*?)(?=\n[F-Z]|\Z)', self.raw_text, re.DOTALL)

        if d_match:
            content = d_match.group(1).strip()
            if "DAILY" in content:
                self.schedule['type'] = 'DAILY'
                time_match = re.search(r'(\d{4})-(\d{4})', content)
                self.schedule['rules'] = {'DAILY': [time_match.group(0)]} if time_match else {}
            # ... (rest of schedule parsing logic remains the same)
            
    def _parse_body(self):
        """Routes to a specific parser based on the determined NOTAM type."""
        e_match = re.search(r'E\)(.*?)(?=\n[F-Z]|\Z)', self.raw_text, re.DOTALL)
        e_content = e_match.group(1).strip() if e_match else ""

        if self.notam_type == 'AREA':
            self._parse_area_details(e_content)
        elif self.notam_type in ['RUNWAY', 'AERODROME_HOURS']:
            self._parse_runway_details(self.raw_text)

    # --- 3. Specialized "Decoder" Sub-Routines ---
    def _parse_area_details(self, e_content):
        """
        NEW: Capable of parsing multiple, numbered areas from the E) field.
        """
        # Split the E-field content by the numbered "AREA:" markers.
        # The pattern looks for a digit, a dot, optional spaces, and "AREA:".
        area_chunks = re.split(r'\d+\.\s*AREA:', e_content)
        
        # The first chunk is usually header text ("TEMPO DANGER AREA ACT WI:"), so we skip it.
        for chunk in area_chunks[1:]:
            area_data = {}
            
            # A. Parse Geometry (Polygon or Circle) from the chunk
            coords = re.findall(r'(\d{6}[NS]\d{7}[EW])', chunk)
            if coords:
                area_data['geometry_type'] = 'POLYGON'
                # Simplify coordinates by removing seconds (e.g., 554500N -> 5545N)
                area_data['points'] = [f"{c[:4]}{c[6]}{c[7:12]}{c[14]}+A+P" for c in coords]
            # (Add circle parsing logic here if needed for other NOTAMs)
            
            # B. Parse Vertical Limits from the chunk
            v_limits_match = re.search(r'(GND|SFC)\s*-\s*(\d+)M\s*AGL', chunk)
            if v_limits_match:
                upper_limit_meters = int(v_limits_match.group(2))
                # Conversion: 1 FL = 100 feet = 30.48 meters
                upper_fl = round(upper_limit_meters / 30.48)
                area_data['lower_fl'] = 'FL001' # From GND/SFC
                area_data['upper_fl'] = f'FL{upper_fl:03d}' # Format as 3 digits, e.g., FL069
            
            # C. Add the fully parsed area to our list
            if 'geometry_type' in area_data:
                self.areas.append(area_data)

    def _parse_runway_details(self, text_content):
        # This function remains as is, parsing runway info
        rwy_match = re.search(r'RWY\s+(\d{2}/\d{2})\s+CLSD', text_content)
        if rwy_match:
            self.subject['identifier'] = rwy_match.group(1)
            self.subject['status'] = "CLOSED"

    # --- 4. AIRlang Formatting ---
    def format_airlang(self):
        """Builds the final AIRlang string from the parsed data."""
        if self.notam_type == "UNKNOWN": return "Could not determine NOTAM type."
        
        timedef = self._format_timedef()
        maindef = ""
        if self.notam_type in ['RUNWAY', 'AERODROME_HOURS']:
            maindef = self._format_rwydef()
        elif self.notam_type == 'AREA':
            maindef = self._format_areadefs() # PLURAL: format multiple areas

        return f"{timedef}\n\n{maindef}"

    def _format_timedef(self):
        # This function remains largely the same
        if self.schedule['type'] == 'DAILY':
            start_f = self.start_time.strftime('%d %b %Y %H:%M')
            end_f = self.end_time.strftime('%d %b %Y %H:%M')
            time_range = self.schedule['rules']['DAILY'][0]
            start_t, end_t = time_range.split('-')
            time_str = f"({start_t[:2]}:{start_t[2:]} TO {end_t[:2]}:{end_t[2:]})"
            return f"TIMEDEF DURATION = {start_f} TO {end_f}: {time_str};"
        # ... (other timedef formats are unchanged)
        return "TIMEDEF DURATION = Not Parsed;" # Fallback

    def _format_rwydef(self):
        # This function remains the same
        ident = self.subject.get('identifier', '')
        status = self.subject.get('status', '')
        return f"RWYDEF {self.airport} {ident} {status} DURATION;"

    def _format_areadefs(self): # PLURAL
        """
        NEW: Generates a list of AREADEF blocks, one for each area parsed.
        """
        areadef_blocks = []
        area_type_code = self.q_code[2:4] # e.g., RD from QRDCA
        area_type_str = self.q_code_map.get(area_type_code, area_type_code) # DANGER

        for i, area in enumerate(self.areas):
            name = f"{self.airport}_{self.notam_id.replace('/', '_')}_{i+1}"
            lines = [f'AREADEF "{name}"']
            
            lower = area.get('lower_fl', 'SFC')
            upper = area.get('upper_fl', 'UNL')
            lines.append(f"    {lower} TO {upper}")
            lines.append(f"    TYPE({area_type_str.upper()})")
            
            if area.get('geometry_type') == 'POLYGON':
                points = ",\n            ".join(area.get('points', []))
                lines.append(f"    POLYGON({points})")
            
            lines.append("    ACTIVE DURATION;")
            areadef_blocks.append("\n".join(lines))
        
        return "\n\n".join(areadef_blocks) # Join each AREADEF with a blank line

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

# For local running
if __name__ == '__main__':
    app.run(debug=True)
    # On Replit, use: app.run(host='0.0.0.0', port=81)
