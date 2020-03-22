// Build with
//  parcel build --target node src/build/mkpkgs.ts

// todo: merge this with src/cli.ts

import fs from 'fs';
import { CoqProject, SearchPath } from './project';



async function main() {

    var coqRoot = '_build/wacoq/vendor/coq',
        coqPkgs = require('./metadata/coq-pkgs.json'),
        addonRoot = 'vendor',
        addonPkgs = require('./metadata/addon-pkgs.json');

    function progressTTY(msg: string, done: boolean = true) {
        process.stdout.write('\r' + msg + (done ? '\n' : ''));
    }
    function progressLog(msg: string, done: boolean = true) {
        if (done) console.log(msg);
    }
    const progress = process.stdout.isTTY ? progressTTY : progressLog;

    var projs = {}, allsp = new SearchPath();

    function createProjects(pkgs: any, baseDir: string) {
        for (let pkg in pkgs) {
            var proj = projs[pkg] = new CoqProject(pkg).fromJson(pkgs[pkg], baseDir);
            allsp.path.push(...proj.searchPath.path);
            proj.searchPath = allsp;
        }
    }
    createProjects(coqPkgs, coqRoot);
    createProjects(addonPkgs, addonRoot);

    for (let pkg in projs) {
        let p = projs[pkg],
            save_as = `bin/coq/${pkg}.coq-pkg`;

        progress(`[${pkg}] `, false);
        fs.writeFileSync(`bin/coq/${pkg}.json`, JSON.stringify(p.createManifest()));

        await new Promise(async resolve => 
        (await p.toZip()).generateNodeStream({compression: 'DEFLATE'})
            .pipe(fs.createWriteStream(save_as))
            .on('finish', () => { progress(`wrote '${save_as}'.`); resolve(); }));
    }
}



main();