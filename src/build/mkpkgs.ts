// Build with
//  parcel build --target node src/build/mkpkgs.ts

// todo: merge this with src/cli.ts

import fs from 'fs';
import path from 'path';
import { CoqProject, SearchPath, ZipVolume } from './project';



class Workspace {
    projs: {[name: string]: CoqProject} = {}
    searchPath = new SearchPath()

    async loadDeps(pkgs: string[], baseDir = 'bin/coq') {
        for (let pkg of pkgs) {
            var proj = new CoqProject(pkg).fromVolume(
                       await ZipVolume.fromFile(`${baseDir}/${pkg}.coq-pkg`));
            this.searchPath.addFrom(proj);
        }
    }

    openProjects(pkgs: any, baseDir: string) {
        for (let pkg in pkgs) {
            var proj = new CoqProject(pkg).fromJson(pkgs[pkg], baseDir);
            this.projs[pkg] = proj;
            this.searchPath.addFrom(proj);
            proj.searchPath = this.searchPath;
        }
    }
}

async function main() {

    var coq = require('./metadata/coq-pkgs.json'),
        addons = require('./metadata/addon-pkgs.json');

    function progressTTY(msg: string, done: boolean = true) {
        process.stdout.write('\r' + msg + (done ? '\n' : ''));
    }
    function progressLog(msg: string, done: boolean = true) {
        if (done) console.log(msg);
    }
    const progress = process.stdout.isTTY ? progressTTY : progressLog;

    var workspace = new Workspace();

    var opts = require('commander')
        .version('0.11.0', '-v, --version')
        .option('--boot',         'build initial Coq packages')
        .parse(process.argv);

    if (opts.boot) {
        workspace.openProjects(coq.projects, coq.rootdir);
    }
    else {
        await workspace.loadDeps(Object.keys(coq.projects));
        workspace.openProjects(addons.projects, addons.rootdir);
    }

    workspace.searchPath.createIndex();

    for (let pkg in workspace.projs) {
        progress(`[${pkg}] `, false);
        var {pkgfile} = await workspace.projs[pkg].toPackage('bin/coq');
        progress(`wrote ${pkgfile}.`, true);
    }
}



main();