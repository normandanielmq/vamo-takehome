export class UnsupportedMarketError extends Error {
  constructor(
    readonly market: string,
    readonly reason: string,
  ) {
    super(`Market "${market}" is not supported: ${reason}`);
  }
}

export class NoEligibleDriversError extends Error {
  constructor(message = 'No eligible drivers for this route') {
    super(message);
  }
}

export class ModelTrainingError extends Error {}

export class InsufficientDataError extends Error {}
