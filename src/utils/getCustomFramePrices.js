const CustomFramePricing = require('../models/CustomFramePricing');
const { DEFAULT_CUSTOM_FRAME_PRICES, validateCustomFramePrices } = require('./customFramePricing');

const getCustomFramePrices = async () => {
  const settings = await CustomFramePricing.findOne({ key: 'default' }).lean();
  if (!settings) return DEFAULT_CUSTOM_FRAME_PRICES;

  const storedPrices = settings.prices;
  try {
    return validateCustomFramePrices(storedPrices);
  } catch (validationError) {
    const hasLegacyPrices = ['single', 'multiple'].some((layout) => (
      ['8x10', '12x16', '16x20'].some((size) => storedPrices?.[layout]?.[size])
    ));
    if (!hasLegacyPrices) throw validationError;
  }

  const legacySizes = ['8x10', '12x16', '16x20'];
  const currentSizes = ['4x6', '5x7', 'A4'];
  const migratedPrices = {};
  for (const layout of ['single', 'multiple']) {
    migratedPrices[layout] = {};
    for (const size of currentSizes) {
      if (storedPrices?.[layout]?.[size]) {
        migratedPrices[layout][size] = storedPrices[layout][size];
      } else {
        const legacySize = legacySizes[currentSizes.indexOf(size)];
        migratedPrices[layout][size] = storedPrices?.[layout]?.[legacySize]
          || DEFAULT_CUSTOM_FRAME_PRICES[layout][size];
      }
    }
  }

  return validateCustomFramePrices(migratedPrices);
};

module.exports = getCustomFramePrices;
