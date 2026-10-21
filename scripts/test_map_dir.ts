import * as fs from 'fs';
import * as path from 'path';

const mapDir = path.resolve(__dirname, '../../Prime View frontend/src/lib/map');
console.log('Map dir exists:', fs.existsSync(mapDir));
console.log('Files in map dir:', fs.readdirSync(mapDir));
