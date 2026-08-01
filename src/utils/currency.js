const CURRENCIES = ['USD', 'TJS'];

// раздел 11 ТЗ: все внутренние расчёты — в USD. exchange_rate = TJS за 1 USD.
function computeAmountUsd(amount, currency, exchangeRate) {
  if (currency === 'USD') return Math.round(Number(amount) * 100) / 100;
  return Math.round((Number(amount) / Number(exchangeRate)) * 100) / 100;
}

module.exports = { CURRENCIES, computeAmountUsd };
