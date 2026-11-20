"""Baselines every candidate is compared with: the incumbent, a naive rule, and plan-based rolling optimisation."""

from core.baselines.incumbent import incumbent_policies
from core.baselines.naive import naive_policies
from core.baselines.rolling import RollingOptimiser, rolling_program

__all__ = ["RollingOptimiser", "incumbent_policies", "naive_policies", "rolling_program"]
