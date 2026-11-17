/**
 * Thrown when a market lacks enough data to be modelled.
 */
export class UnsupportedMarketError extends Error {
  /**
   * Creates the error.
   *
   * @param market - The unsupported market.
   * @param reason - Why the market is unsupported.
   */
  constructor(
    readonly market: string,
    readonly reason: string,
  ) {
    super(`Market "${market}" is not supported: ${reason}`);
  }
}

/**
 * Thrown when there are no drivers to offer a route to.
 */
export class NoEligibleDriversError extends Error {
  /**
   * Creates the error.
   *
   * @param message - Error message.
   */
  constructor(message = 'No eligible drivers for this route') {
    super(message);
  }
}

/**
 * Thrown when a model cannot be trained (e.g. singular system or no convergence).
 */
export class ModelTrainingError extends Error {}

/**
 * Thrown when there is not enough historical data to proceed.
 */
export class InsufficientDataError extends Error {}
