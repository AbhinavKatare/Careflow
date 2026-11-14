"""
Resilience utilities: Circuit Breaker and Bounded Retries with Jitter.
"""

import time
import random
from enum import Enum
from typing import Callable, Optional, TypeVar
from backend.llm.types import (
    LLMAdapterError,
    LLMCircuitBreakerError,
    LLMMalformedJSONError,
    LLMProviderError,
    LLMSchemaValidationError,
    LLMTimeoutError,
)

T = TypeVar("T")


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """
    Standard three-state circuit breaker pattern.
    Fails fast when consecutive failures exceed failure_threshold.
    """
    def __init__(
        self,
        failure_threshold: int = 3,
        recovery_timeout: float = 2.0,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.state = CircuitState.CLOSED
        self.consecutive_failures = 0
        self.last_failure_time: Optional[float] = None

    def can_execute(self) -> bool:
        now = time.monotonic()
        if self.state == CircuitState.CLOSED:
            return True
        elif self.state == CircuitState.OPEN:
            if self.last_failure_time and (now - self.last_failure_time) >= self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                return True
            return False
        elif self.state == CircuitState.HALF_OPEN:
            return True
        return False

    def record_success(self) -> None:
        self.consecutive_failures = 0
        self.state = CircuitState.CLOSED
        self.last_failure_time = None

    def record_failure(self) -> None:
        self.consecutive_failures += 1
        self.last_failure_time = time.monotonic()
        if self.consecutive_failures >= self.failure_threshold:
            self.state = CircuitState.OPEN

    def reset(self) -> None:
        self.state = CircuitState.CLOSED
        self.consecutive_failures = 0
        self.last_failure_time = None


def execute_with_resilience(
    func: Callable[[], T],
    circuit_breaker: CircuitBreaker,
    max_retries: int = 2,
    base_delay: float = 0.05,
    max_delay: float = 0.5,
    jitter: float = 0.02,
) -> T:
    """
    Executes a callable under circuit breaker protection with bounded retries and exponential jitter.
    Schema validation errors are deterministic and not retried.
    """
    last_error: Optional[Exception] = None

    for attempt in range(max_retries + 1):
        if not circuit_breaker.can_execute():
            raise LLMCircuitBreakerError(
                f"Circuit breaker is OPEN. Fast failing after {circuit_breaker.consecutive_failures} consecutive failures."
            )

        try:
            result = func()
            circuit_breaker.record_success()
            return result
        except LLMSchemaValidationError as err:
            # Deterministic schema validation errors fail immediately without retry
            circuit_breaker.record_failure()
            raise err
        except (LLMTimeoutError, LLMMalformedJSONError, LLMProviderError) as err:
            last_error = err
            circuit_breaker.record_failure()
            if attempt < max_retries:
                backoff = min(max_delay, base_delay * (2 ** attempt)) + random.uniform(0, jitter)
                time.sleep(backoff)
            else:
                raise err
        except Exception as err:
            circuit_breaker.record_failure()
            raise LLMAdapterError(f"Unexpected error in resilient execution: {err}") from err

    if last_error:
        raise last_error
    raise LLMAdapterError("Execution failed with unknown error")

