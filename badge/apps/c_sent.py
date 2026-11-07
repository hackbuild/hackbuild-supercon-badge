"""Sent: the last image sent from the web controller."""
from apps.base_app import BaseApp
from lib import hb_state


class SentApp(BaseApp):
    _instance = None

    def __init__(self, name=None):
        super().__init__("Sent")
        self.sleep_ms = 200
        self.pending = False
        self.request = False
        SentApp._instance = self

    def run(self):
        if self.launched or self.request:
            self.request = False
            self.pending = True
            hb_state.remember("image")
        if self.pending and hb_state.panel_idle():
            self.pending = False
            if not hb_state.show_sent():
                hb_state.show_png("/data/hb/logo.png")
