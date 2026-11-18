"""Probability distributions for lead times, demand and assumptions, as a discriminated union on `kind`.

All parameters are bounded. Sampling lives here so that the network, the simulator and the monitors draw the same
way; every sampler takes an explicit `numpy.random.Generator` (no global state).
"""

from __future__ import annotations

from typing import Annotated, Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import Field, model_validator

from core.domain.common import Model

BIG = 1e7


class Deterministic(Model):
    kind: Literal["deterministic"] = "deterministic"
    value: float = Field(ge=0, le=BIG)

    def mean(self) -> float:
        return self.value

    def sd(self) -> float:
        return 0.0

    def sample(self, rng: np.random.Generator, size: tuple[int, ...]) -> NDArray[np.float64]:
        return np.full(size, self.value, dtype=np.float64)


class Normal(Model):
    """Normal, truncated at zero when sampled."""

    kind: Literal["normal"] = "normal"
    mu: float = Field(ge=0, le=BIG, description="Mean")
    sigma: float = Field(ge=0, le=BIG, description="Standard deviation")

    def mean(self) -> float:
        return self.mu

    def sd(self) -> float:
        return self.sigma

    def sample(self, rng: np.random.Generator, size: tuple[int, ...]) -> NDArray[np.float64]:
        return np.maximum(rng.normal(self.mu, self.sigma, size), 0.0)


class Gamma(Model):
    """Gamma by mean and coefficient of variation (a common way to state lead-time variability)."""

    kind: Literal["gamma"] = "gamma"
    mu: float = Field(gt=0, le=BIG, description="Mean")
    cv: float = Field(gt=0, le=5, description="Coefficient of variation (sd / mean)")

    def mean(self) -> float:
        return self.mu

    def sd(self) -> float:
        return self.mu * self.cv

    def sample(self, rng: np.random.Generator, size: tuple[int, ...]) -> NDArray[np.float64]:
        shape = 1.0 / (self.cv * self.cv)
        return rng.gamma(shape, self.mu / shape, size)


class Triangular(Model):
    kind: Literal["triangular"] = "triangular"
    low: float = Field(ge=0, le=BIG)
    mode: float = Field(ge=0, le=BIG)
    high: float = Field(ge=0, le=BIG)

    @model_validator(mode="after")
    def _order(self) -> Triangular:
        if not self.low <= self.mode <= self.high or self.low == self.high:
            raise ValueError("need low ≤ mode ≤ high with low < high")
        return self

    def mean(self) -> float:
        return (self.low + self.mode + self.high) / 3

    def sd(self) -> float:
        a, b, c = self.low, self.high, self.mode
        return float(np.sqrt((a * a + b * b + c * c - a * b - a * c - b * c) / 18))

    def sample(self, rng: np.random.Generator, size: tuple[int, ...]) -> NDArray[np.float64]:
        return rng.triangular(self.low, self.mode, self.high, size)


class Discrete(Model):
    kind: Literal["discrete"] = "discrete"
    values: list[Annotated[float, Field(ge=0, le=BIG)]] = Field(min_length=1, max_length=50)
    probs: list[Annotated[float, Field(ge=0, le=1)]] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _probs(self) -> Discrete:
        if len(self.values) != len(self.probs):
            raise ValueError("values and probs must have the same length")
        if abs(sum(self.probs) - 1.0) > 1e-6:
            raise ValueError("probs must sum to 1")
        return self

    def mean(self) -> float:
        return float(np.dot(self.values, self.probs))

    def sd(self) -> float:
        m = self.mean()
        return float(np.sqrt(np.dot(self.probs, (np.asarray(self.values) - m) ** 2)))

    def sample(self, rng: np.random.Generator, size: tuple[int, ...]) -> NDArray[np.float64]:
        return rng.choice(np.asarray(self.values, dtype=np.float64), size=size, p=np.asarray(self.probs))


Distribution = Annotated[Deterministic | Normal | Gamma | Triangular | Discrete, Field(discriminator="kind")]
