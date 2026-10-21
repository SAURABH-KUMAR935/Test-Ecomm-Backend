const FRAME_SIZES = ['A4', '4x6', '5x7'];
const FRAME_COLORS = ['natural-wood', 'black', 'white', 'gold'];
const PHOTO_LAYOUTS = ['single', 'multiple'];
const FRAME_ORIENTATIONS = ['portrait', 'landscape'];
const MAX_CUSTOM_FRAME_QUANTITY = 10;
const MAX_FRAME_PRICE = 1000000;

const DEFAULT_CUSTOM_FRAME_PRICES = Object.freeze({
  single: Object.freeze({
    A4: Object.freeze({
      'natural-wood': 4200,
      black: 4350,
      white: 4380,
      gold: 4550,
    }),
    '4x6': Object.freeze({
      'natural-wood': 1800,
      black: 1950,
      white: 1980,
      gold: 2150,
    }),
    '5x7': Object.freeze({
      'natural-wood': 2800,
      black: 2950,
      white: 2980,
      gold: 3150,
    }),
  }),
  multiple: Object.freeze({
    A4: Object.freeze({
      'natural-wood': 4200,
      black: 4350,
      white: 4380,
      gold: 4550,
    }),
    '4x6': Object.freeze({
      'natural-wood': 1800,
      black: 1950,
      white: 1980,
      gold: 2150,
    }),
    '5x7': Object.freeze({
      'natural-wood': 2800,
      black: 2950,
      white: 2980,
      gold: 3150,
    }),
  }),
});

const validateCustomFramePrices = (prices) => {
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) {
    throw new Error('Provide a valid custom-frame price table.');
  }

  const validatedPrices = {};
  for (const layout of PHOTO_LAYOUTS) {
    if (!prices[layout] || typeof prices[layout] !== 'object' || Array.isArray(prices[layout])) {
      throw new Error(`Provide prices for the ${layout} photo layout.`);
    }

    validatedPrices[layout] = {};
    for (const size of FRAME_SIZES) {
      if (!prices[layout][size] || typeof prices[layout][size] !== 'object' || Array.isArray(prices[layout][size])) {
        throw new Error(`Provide ${layout} photo prices for ${size} frames.`);
      }

      validatedPrices[layout][size] = {};
      for (const color of FRAME_COLORS) {
        const amount = prices[layout][size][color];
        if (!Number.isInteger(amount) || amount < 0 || amount > MAX_FRAME_PRICE) {
          throw new Error(`The ${layout} ${size} ${color} price must be a whole amount between 0 and ${MAX_FRAME_PRICE}.`);
        }
        validatedPrices[layout][size][color] = amount;
      }
    }
  }

  return validatedPrices;
};

const calculateCustomFramePricing = ({
  frameSize,
  frameColor,
  quantity,
  photoLayout = 'single',
}, prices = DEFAULT_CUSTOM_FRAME_PRICES) => {
  if (!FRAME_SIZES.includes(frameSize)) {
    throw new Error('Please select a valid frame size.');
  }

  if (!FRAME_COLORS.includes(frameColor)) {
    throw new Error('Please select a valid frame color.');
  }

  if (!PHOTO_LAYOUTS.includes(photoLayout)) {
    throw new Error('Please select a valid photo layout.');
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CUSTOM_FRAME_QUANTITY) {
    throw new Error(`Custom frame quantity must be between 1 and ${MAX_CUSTOM_FRAME_QUANTITY}.`);
  }

  const unitPrice = prices[photoLayout][frameSize][frameColor];
  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    throw new Error('Custom-frame pricing is not configured correctly.');
  }

  return {
    frameSize,
    frameColor,
    photoLayout,
    quantity,
    unitPrice,
    totalPrice: unitPrice * quantity,
    currency: 'INR',
  };
};

const validateFrameOrientation = (orientation) => {
  if (!FRAME_ORIENTATIONS.includes(orientation)) {
    throw new Error('Please select a valid photo orientation.');
  }
};

module.exports = {
  DEFAULT_CUSTOM_FRAME_PRICES,
  calculateCustomFramePricing,
  validateCustomFramePrices,
  validateFrameOrientation,
};
