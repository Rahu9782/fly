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

        # --- Parsed He
