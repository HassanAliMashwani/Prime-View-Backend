import { abbottBlockAreas } from '../../Prime View frontend/src/lib/map/abbottBlockAreas';
import { royalBlockAreas } from '../../Prime View frontend/src/lib/map/royalBlockAreas';
import { overseasBlockAreas } from '../../Prime View frontend/src/lib/map/overseasBlockAreas';

console.log('--- Abbott areas with plotNumber in [1, 2, 3, 4, 5, 6, 12, 14] ---');
for (const a of abbottBlockAreas) {
  if (['1', '2', '3', '4', '5', '6', '12', '14'].includes(a.plotNumber || '')) {
    console.log(a.slug, a.plotNumber, a.category, a.sizeLabel);
  }
}

console.log('\n--- Royal areas with plotNumber like R-01, 1, B-05, etc. ---');
for (const a of royalBlockAreas) {
  if (a.plotNumber && (['1', '2', '3', '5', '6', '7', '8'].includes(a.plotNumber) || a.plotNumber.includes('R') || a.plotNumber.includes('B'))) {
    console.log(a.slug, a.plotNumber, a.category, a.sizeLabel);
  }
}

console.log('\n--- Overseas areas with plotNumber like OV, C-08, 1, etc. ---');
for (const a of overseasBlockAreas) {
  if (a.plotNumber && (a.plotNumber.includes('OV') || a.plotNumber.includes('C-') || ['1', '2', '3', '4', '8', '9'].includes(a.plotNumber))) {
    console.log(a.slug, a.plotNumber, a.category, a.sizeLabel);
  }
}
