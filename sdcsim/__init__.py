"""sdcsim — reduced-order multiphysics simulator for orbital data centers.

Implements the coupling map: workload -> power -> heat -> radiator -> Tj ->
DVFS throttle -> effective FLOPS, with radiation/degradation overlays and a
Monte-Carlo wrapper over solar-cycle & environment uncertainty.
"""
from .params import (Config, OrbitParams, ChipParams, ThermalParams, EPSParams,
                     RadParams, ReliabilityParams, MassParams, MissionParams,
                     baseline_dd, iss_like)
from .design import size_design, Design
from .mission import run_mission, summarize, MissionResult
from .montecarlo import run_monte_carlo

__all__ = ["Config", "OrbitParams", "ChipParams", "ThermalParams", "EPSParams",
           "RadParams", "ReliabilityParams", "MassParams", "MissionParams",
           "baseline_dd", "iss_like", "size_design", "Design",
           "run_mission", "summarize", "MissionResult", "run_monte_carlo"]
