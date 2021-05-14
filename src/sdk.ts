import fs from 'fs';
import path from 'path';
import mkdirp from 'mkdirp';
import findUp from 'find-up';
import glob from 'glob';
import unzip from 'fflate-unzip';
import chld from 'child-process-promise';


const SDK = '/tmp/wacoq-sdk';


async function sdk(basedir = SDK) {
    mkdirp.sync(basedir);

    // Locate `coq-pkgs`
    var nm = findNM(), from;
    for (let sp of ['jscoq/coq-pkgs', 'wacoq-bin/bin/coq']) {
        var fp = path.join(nm, sp);
        if (fs.existsSync(fp)) from = fp;
    }
    if (!from) throw {err: "Package bundles (*.coq-pkg) not found"};

    // - unzip everything in `coqlib`
    var coqlib = path.join(basedir, 'coqlib');
    if (isNewer(from, coqlib)) {
        for (let fn of glob.sync('*.coq-pkg', {cwd: from})) {
            var fp = path.join(from, fn);
            await unzip(fp, coqlib);
        }

        // - link `theories` and `plugins` to be consistent with Coq dist structure
        for (let link of ['theories', 'plugins'])
            ln_sf('Coq', path.join(coqlib, link));

        touch(coqlib);
    }

    // Locate native Coq
    var coqlibNative = await findCoq();

    // - link libs in `ml`
    var mlDir = path.join(basedir, 'ml');
    if (isNewer(coqlibNative, mlDir)) {
        mkdirp.sync(mlDir);
        for (let fn of glob.sync('**/*.cmxs', {cwd: coqlibNative}))
            ln_sf(
                path.join(coqlibNative, fn),
                path.join(mlDir, path.basename(fn)));

        touch(coqlib);
    }

    return {coqlib, include: mlDir};
}

async function runCoqC(cfg: {coqlib: string, include: string},
                       args: string[]) {
    var {coqlib, include} = cfg,
        args = ['-coqlib', coqlib, '-include', include, ...args];
    try {
        await chld.spawn('coqc', args, {stdio: 'inherit'});
    }
    catch { throw {err: 'coqc error'}; }
}

/*- specific helpers -*/

function findNM() {
    var nm = findUp.sync('node_modules', {type: 'directory'});
    if (!nm) throw {err: "node_modules directory not found"};
    return nm;
}

async function findCoq() {
    var cfg = await chld.exec("coqc -config"),
        mo = cfg.stdout.match(/^COQLIB=(.*)/m);
    if (!mo) throw {err: "Coq config COQLIB=_ not found"};
    return mo[1];
}

/*- some shutil -*/

function isNewer(fn1: string, fn2: string) {
    try { var s1 = fs.statSync(fn1).mtime; } catch { return false; }
    try { var s2 = fs.statSync(fn2).mtime; } catch { return true; }
    return s1 > s2;
}

function ln_sf(target: string, source: string) {
    try { fs.unlinkSync(source); }
    catch { }
    fs.symlinkSync(target, source);
}

function touch(fn: string) {
    var tm = Date.now();
    fs.utimesSync(fn, tm, tm);
}

/*- main entry point -*/

async function main(args: string[]) {
    try {
        var cfg = await sdk();
        await runCoqC(cfg, args);
        return 0;
    }
    catch (e) {
        if (e.err) console.log('oops: ' + e.err);
        else console.error(e);
        return 1;
    }
}


export { main }