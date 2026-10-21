import { eliteBlockAreas } from '../../Prime View frontend/src/lib/map/eliteBlockAreas';

for (const a of eliteBlockAreas) {
  if (a.plotNumber && (a.plotNumber.includes('155') || a.plotNumber.includes('154') || a.plotNumber.includes('156'))) {
    console.log(a.slug, a.plotNumber, a.category, a.sizeLabel);
  }
}
