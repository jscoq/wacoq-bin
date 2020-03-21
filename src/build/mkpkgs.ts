// Build with
//  parcel build --target node src/build/mkpkgs.ts

// todo: merge this with src/cli.ts

import fs from 'fs';
import { CoqProject } from './project';



async function main() {

    var coqRoot = '_build/wacoq/vendor/coq',
        pkgs = require('./coq-pkgs.json');

    function progressTTY(msg: string, done: boolean = true) {
        process.stdout.write('\r' + msg + (done ? '\n' : ''));
    }
    function progressLog(msg: string, done: boolean = true) {
        if (done) console.log(msg);
    }
    const progress = process.stdout.isTTY ? progressTTY : progressLog;

    for (let pkg in pkgs) {
        let p = new CoqProject(pkg).fromJson(pkgs[pkg], coqRoot),
            save_as = `bin/coq/${pkg}.coq-pkg`;

        progress(`[${pkg}] `, false);
        fs.writeFileSync(pkg + '.json', JSON.stringify(p.createManifest()));

        await new Promise(async resolve => 
        (await p.toZip()).generateNodeStream({compression: 'DEFLATE'})
            .pipe(fs.createWriteStream(save_as))
            .on('finish', () => { progress(`wrote '${save_as}'.`); resolve(); }));
    }
}


main();