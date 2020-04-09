// Build with
//  parcel build --target node src/build/mkpkgs.ts

// todo: merge this with src/cli.ts

import fs from 'fs';
import path from 'path';
import { CoqProject, SearchPath, ZipVolume, JsCoqCompat } from './project';



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

    async loadDeps(pkgs: string[], baseDir = '') {
        for (let pkg of pkgs) {
            if (!pkg.match(/[.][^./]+$/)) pkg += '.coq-pkg';
            var proj = new CoqProject(pkg).fromDirectory('',
                       await ZipVolume.fromFile(path.join(baseDir, pkg)));
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
                      baseDir: string, prefix: string, dirPaths: string[]) {
        var name = path.basename(nameOrPackage).replace(/[.][^.]*$/, '');
        let proj = new CoqProject(name).fromJson({
            "": { prefix, 'dirpaths': dirPaths }
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

    var refs: string[] = [];

    var opts = require('commander')
        .version('0.11.0', '-v, --version')
        .option('--workspace <w.json>',       'build projects from specified workspace')
        .option('--project <dir>',            'base directory for finding `.v` and `.vo` files')
        .option('--top <name>',               'logical name of toplevel directory')
        .option('--dirpaths <a.b.c>',         'logical paths containing modules (comma separated)', '')
        .option('--package <f.coq-pkg>',      'create a package (default extension is `.coq-pkg`)')
        .option('--ref <f.coq-pkg>',          'consider `f.coq-pkg` for module dependencies')
        .option('--boot',                     'build initial Coq packages')
        .option('--jscoq',                    'jsCoq compatibility mode')
        .on('option:ref', (fn: string) => refs.push(fn))
        .parse(process.argv);

    var pkgdir = 'bin/coq', outdir = pkgdir;

    if (opts.boot) {
        workspace.openProjects(coq.projects, coq.rootdir);
    }
    else {
        await workspace.loadDeps(Object.keys(coq.projects), pkgdir);
        await workspace.loadDeps(refs);
        if (opts.workspace)
            workspace.open(opts.workspace);
        else
            workspace.openProjectDirect(opts.package, opts.project, opts.top,
                                        opts.dirpaths.split(/[, ]/));
    }

    workspace.searchPath.createIndex();

    var f = opts.jscoq && JsCoqCompat.backportManifest;

    for (let pkgname in workspace.projs) {
        progress(`[${pkgname}] `, false);
        var {pkg} =await (await workspace.projs[pkg]
                          .toPackage(opts.package || path.join(outdir, pkg),
                                     undefined, undefined, f)
                         ).save();
        progress(`wrote ${pkg.filename}.`, true);
    }
}



main();