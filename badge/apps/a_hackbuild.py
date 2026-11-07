"""hack.build: the logo and wordmark. The main app, first in the menu and shown at boot."""
from apps.base_app import BaseApp
from lib import hb_state


class HackBuildApp(BaseApp):
    def __init__(self, name=None):
        super().__init__("hack.build")
        self.sleep_ms = 100
        self.pending = False
        self.request = False

    def run(self):
        if self.launched or self.request:
            self.request = False
            self.pending = True
            hb_state.remember("logo")
        if self.pending and hb_state.panel_idle():
            self.pending = False
            hb_state.show("/data/hb/logo.z")
