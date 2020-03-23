// Build with
//  parcel build --target node src/build/mkpkgs.ts

// todo: merge this with src/cli.ts

import fs from 'fs';
import path from 'path';
import { CoqProject, SearchPath, ZipVolume } from './project';



class Workspace {
    projs: {[name: string]: CoqProject} = {}
    searchPath = new SearchPath()

    open(jsonFilename: string) {
        try {
            var json = JSON.parse(<any>fs.readFileSync(jsonFilename));
            this.openProjects(json.projects, json.rootdir);
        }
        catch (e) {
            console.warn(`cannot open workspace '${jsonFilename}': ${e}`);
        }
    }

    async loadDeps(pkgs: string[], baseDir = 'bin/coq') {
        for (let pkg of pkgs) {
            var proj = new CoqProject(pkg).fromVolume(
                       await ZipVolume.fromFile(`${baseDir}/${pkg}.coq-pkg`));
            this.searchPath.addFrom(proj);
        }
    }

    addProject(proj: CoqProject) {
        this.projs[proj.name] = proj;
        this.searchPath.addFrom(proj);
        proj.searchPath = this.searchPath;
    }

    openProjects(pkgs: any, baseDir: string) {
        for (let pkg in pkgs) {
            var proj = new CoqProject(pkg).fromJson(pkgs[pkg], baseDir);
            this.addProject(proj);
        }
    }

    openProjectDirect(nameOrPackage: string,
                      baseDir: string, dirPaths: string[]) {
        var name = path.basename(nameOrPackage).replace(/[.][^.]*$/, '');
        let proj = new CoqProject(name).fromJson({
            "": { 'dirpaths': dirPaths }
        }, baseDir);
        this.addProject(proj);
    }
}


async function main() {

    var coq = require('./metadata/coq-pkgs.json');

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
        .option('--workspace <w.json>',       'build projects from specified workspace')
        .option('--project <dir>',            'base directory for finding `.v` and `.vo` files')
        .option('--dirpaths <a.b.c>',         'logical paths containing modules (comma separated)')
        .option('--package <f.coq-pkg>',      'create a package (default extension is `.coq-pkg`)')
        .option('--boot',                     'build initial Coq packages')
        .parse(process.argv);

    var pkgdir = 'bin/coq', outdir = pkgdir;

    if (opts.boot) {
        workspace.openProjects(coq.projects, coq.rootdir);
    }
    else if (opts.workspace) {
        await workspace.loadDeps(Object.keys(coq.projects), pkgdir);
        workspace.open(opts.workspace);
    }
    else {
        await workspace.loadDeps(Object.keys(coq.projects));
        workspace.openProjectDirect(opts.package, opts.project,
                                    opts.dirpaths.split(/[, ]/));
    }

    workspace.searchPath.createIndex();

    for (let pkg in workspace.projs) {
        progress(`[${pkg}] `, false);
        var {pkgfile} = await workspace.projs[pkg]
                        .toPackage(opts.package || path.join(outdir, pkg));
        progress(`wrote ${pkgfile}.`, true);
    }
}



main();