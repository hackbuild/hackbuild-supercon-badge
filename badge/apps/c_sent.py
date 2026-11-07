"""Sent: the last image sent from the web controller."""
from apps.base_app import BaseApp
from lib import hb_state


class SentApp(BaseApp):
    def __init__(self, name=None):
        super().__init__("Sent")
        self.sleep_ms = 100
        self.pending = False
        self.request = False

    def run(self):
        if self.launched or self.request:
            self.request = False
            self.pending = True
            hb_state.remember("image")
        if self.pending and hb_state.panel_idle():
            self.pending = False
            if not hb_state.show(hb_state.SENT_PATH):
                hb_state.show("/data/hb/logo.z")
