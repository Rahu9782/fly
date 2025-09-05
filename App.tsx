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
# ## THE UNIFIED NOTAM DECODER CLASS
# ############################################################################

class NotamDecoder:
    """
    A comprehensive NOTAM decoder that parses raw text and translates it into
    a structured AIRlang rule. It uses a hybrid regex/NLP approach to handle
    various NOTAM formats for runways, restricted areas, and schedules.
    """
    def __init__(self, notam_text):
        # --- Raw Data ---
        self.raw_text = notam_text

        # --- Parsed Header & Core Info ---
        self.notam_id = None
        self.airport = None
        self.q_code = None
        self.notam_type = "UNKNOWN" # Will be 'AREA', 'RUNWAY', etc.
        self.start_time = None
        self.end_time = None

        # --- Parsed Body Details ---
        self.schedule = {'type': 'CONTINUOUS', 'rules': {}}
        self.geometry = {} # For polygons or circles
        self.vertical_limits = {'lower': 'SFC', 'upper': 'UNL'}
        self.subject = {} # For runway number, status, etc.
        self.details = ""

        # --- Begin the decoding process ---
        self._decode()

    # --- 1. Main Decoding Orchestrator ---
    def _decode(self):
        """Orchestrates the entire parsing process."""
        self._parse_header()
        self._determine_type()
        self._parse_schedule()
        self._parse_body() # This calls specific parsers based on type

    # --- 2. Parsing Sub-Routines ---
    def _parse_header(self):
        """Uses reliable regex to extract the foundational fields."""
        # NOTAM ID (e.g., A2170/25)
        id_match = re.search(r'\(([A-Z]\d{4}/\d{2})', self.raw_text)
        if id_match: self.notam_id = id_match.group(1)
        
        # Q-Line (e.g., Q)SKEC/QMRLC/...)
        q_match = re.search(r'Q\)\s*\w{4}/(\w{5})/[\s\S]*?/(\d{3})/(\d{3})/', self.raw_text)
        if q_match:
            self.q_code = q_match.group(1)
            self.vertical_limits['lower'] = f"FL{q_match.group(2)}"
            self.vertical_limits['upper'] = f"FL{q_match.group(3)}"

        # A) Airport, B) Start Time, C) End Time
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
        elif self.q_code.startswith('QRT') or self.q_code.startswith('QW'): self.notam_type = 'AREA'
        elif self.q_code.startswith('QFA'): self.notam_type = 'AERODROME_HOURS' # Can affect runways

    def _parse_schedule(self):
        """Decodes the D) or E) field to understand the active schedule."""
        d_match = re.search(r'D\)(.*?)(?=\n[A-Z]\)|$)', self.raw_text, re.DOTALL)
        e_match = re.search(r'E\)(.*?)(?=\n[F-Z]|\Z)', self.raw_text, re.DOTALL)

        if d_match:
            d_content = d_match.group(1).strip()
            if "DAILY" in d_content:
                self.schedule['type'] = 'DAILY'
                time_match = re.search(r'(\d{4})-(\d{4})', d_content)
                self.schedule['rules'] = {'DAILY': [time_match.group(0)]}
            elif any(day in d_content for day in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]):
                self.schedule['type'] = 'WEEKLY'
                self.schedule['rules'] = self._decode_weekly_schedule(d_content)
            else: # D field with specific dates (e.g., 03-07 10)
                self.schedule['type'] = 'SPECIFIC_DATES'
                self.schedule['rules'] = self._decode_date_range_schedule(d_content)
        elif e_match:
             # E field with specific dates (e.g., JUL 30)
            if any(month in e_match.group(1) for month in ["JUL", "AUG", "SEP"]):
                self.schedule['type'] = 'SPECIFIC_DATES'
                self.schedule['rules'] = self._decode_specific_date_schedule(e_match.group(1))

    def _parse_body(self):
        """Routes to a specific parser based on the determined NOTAM type."""
        e_match = re.search(r'E\)(.*?)(?=\n[F-Z]|\Z)', self.raw_text, re.DOTALL)
        e_content = e_match.group(1).strip() if e_match else ""

        if self.notam_type == 'AREA':
            self._parse_area_details(e_content)
        elif self.notam_type == 'RUNWAY' or self.notam_type == 'AERODROME_HOURS':
            # Use the entire NOTAM text as context for runway info
            self._parse_runway_details(self.raw_text)

    # --- 3. Specialized "Decoder" Sub-Routines ---
    def _decode_weekly_schedule(self, d_content):
        # Uses NLP to handle complex weekly schedules like "MON FRI 0800-1200"
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
    
    def _decode_date_range_schedule(self, d_content):
        rules = {}
        time_match = re.search(r'(\d{4}-\d{4})', d_content)
        if not time_match: return {}
        time_range = time_match.group(1)
        date_part = d_content.replace(time_range, '').strip()
        days = []
        for match in re.finditer(r'(\d{2})-(\d{2})|(\d{2})', date_part):
            if match.group(1): days.extend(range(int(match.group(1)), int(match.group(2)) + 1))
            else: days.append(int(match.group(3)))
        month = self.start_time.month
        year = self.start_time.year
        for day in days:
            date_key = datetime(year, month, day).strftime('%d %b').upper()
            rules[date_key] = [time_range]
        return rules

    def _decode_specific_date_schedule(self, e_content):
        rules = {}
        current_month = None
        year = self.start_time.year
        for line in e_content.split('\n'):
            line = line.strip()
            month_match = re.match(r'([A-Z]{3})\s+([\d\s]+)\s+(\d{4}-\d{4})', line)
            if month_match:
                current_month = datetime.strptime(month_match.group(1), '%b').month
                days_str, time_range = month_match.group(2).strip(), month_match.group(3)
                for day in [int(d) for d in days_str.split()]:
                    date_key = datetime(year, current_month, day).strftime('%d %b').upper()
                    rules[date_key] = [time_range]
        return rules

    def _parse_area_details(self, e_content):
        # Circle
        circle_match = re.search(r'CIRCLE RADIUS (\d+NM) CENTERED ON (\d{6}[NS]\d{7}[EW])', e_content)
        if circle_match:
            self.geometry['type'] = 'CIRCLE'
            self.geometry['radius'] = circle_match.group(1).replace('NM', ' NM')
            lat, lon = circle_match.group(2)[:7], circle_match.group(2)[7:]
            self.geometry['center'] = f"{lat[:4]}{lat[6]}N{lon[:5]}{lon[7]}E+A+P" # Simplified format
            return

        # Polygon
        coords = re.findall(r'(\d{6}[NS]\d{7}[EW])', e_content)
        if coords:
            self.geometry['type'] = 'POLYGON'
            self.geometry['points'] = [f"{c[:4]}{c[6]}{c[7:12]}{c[14]}+A+P" for c in coords]

    def _parse_runway_details(self, text_content):
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
        if self.notam_ty
