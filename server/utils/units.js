/*
  Shippo wants weight in ounces and sizes in inches. The store measures in its own units (the Units tab of the Shipping
  page), and the hook is told which, so a parcel is converted before it is sent. Pure, so it can be tested alone.
*/
const GRAMS = { oz: 28.349523125, lb: 453.59237, g: 1, kg: 1000 };
const MILLIMETRES = { in: 25.4, cm: 10 };

export const toOunces = (value, unit) => (GRAMS[unit] ? value * GRAMS[unit] / GRAMS.oz : null);

export const toInches = (value, unit) => (MILLIMETRES[unit] ? value * MILLIMETRES[unit] / MILLIMETRES.in : null);
