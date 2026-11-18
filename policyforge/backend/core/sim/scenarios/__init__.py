"""Scenario generators: a scenario plus a seed gives every random draw a simulation needs, up front."""

from core.sim.scenarios.generate import Draws, generate
from core.sim.scenarios.library import default_suite

__all__ = ["Draws", "default_suite", "generate"]
