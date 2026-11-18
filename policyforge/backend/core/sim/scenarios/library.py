"""The default stress-test suite: eight scenarios for FoodNet, from a quiet baseline to a correlated shock."""

from __future__ import annotations

from core.domain.scenario import (
    BaselineDemand,
    CorrelatedShock,
    DemandShift,
    LeadTimeInflation,
    PlantCapacityLoss,
    Scenario,
    ScenarioSet,
    SignalNoise,
    SupplierOutage,
    Window,
)


def default_suite() -> ScenarioSet:
    return ScenarioSet(
        id="default-suite",
        name="Default stress-test suite",
        scenarios=[
            Scenario(id="baseline", name="Baseline",
                     description="Seasonal stochastic demand, normal lead times and fill rates.",
                     components=[BaselineDemand()]),
            Scenario(id="demand-surge", name="North demand surge",
                     description="Demand in the North markets rises 30 % from week 30 for 16 weeks.",
                     components=[BaselineDemand(),
                                 DemandShift(window=Window(start=30, duration=16), factor=1.3,
                                             markets=["MKT_N1", "MKT_N2"])]),
            Scenario(id="promotion", name="Ambient promotion spike",
                     description="Ambient demand doubles for 3 weeks from week 40.",
                     components=[BaselineDemand(),
                                 DemandShift(window=Window(start=40, duration=3), factor=2.0, categories=["ambient"])]),
            Scenario(id="supplier-b-outage", name="Supplier B outage",
                     description="Supplier B loses 80 % of its capacity from week 20 for 8 weeks.",
                     components=[BaselineDemand(),
                                 SupplierOutage(supplier="SUP_B", window=Window(start=20, duration=8), severity=0.8)]),
            Scenario(id="lead-time-inflation", name="Supplier B lead-time creep",
                     description="Supplier B's lead times double, ramping up over 10 weeks from week 20.",
                     components=[BaselineDemand(),
                                 LeadTimeInflation(supplier="SUP_B", start=20, factor=2.0, ramp_periods=10)]),
            Scenario(id="plant-capacity-loss", name="North plant capacity loss",
                     description="The North plant loses half its capacity from week 30 for 12 weeks.",
                     components=[BaselineDemand(),
                                 PlantCapacityLoss(plant="PLANT_N", window=Window(start=30, duration=12),
                                                   severity=0.5)]),
            Scenario(id="correlated-shock", name="Correlated shock",
                     description="In half the futures, Suppliers A and B lose 60 % of capacity, their lead times "
                                 "rise 50 %, and North and Central demand jumps 20 %, all at once, for 8 weeks "
                                 "starting between weeks 15 and 60.",
                     components=[BaselineDemand(),
                                 CorrelatedShock(probability=0.5, earliest_start=15, latest_start=60, duration=8,
                                                 suppliers=["SUP_A", "SUP_B"], supply_severity=0.6,
                                                 lead_time_factor=1.5,
                                                 markets=["MKT_N1", "MKT_N2", "MKT_C1", "MKT_C2"],
                                                 demand_factor=1.2)]),
            Scenario(id="bullwhip", name="Noisy, delayed signals",
                     description="Observed demand carries 30 % noise and information arrives 2 weeks later.",
                     components=[BaselineDemand(), SignalNoise(noise_cv=0.3, extra_delay=2)]),
        ],
    )
