// Build with
//  parcel watch --target node src/cli.ts

import path from 'path';
import commander from 'commander';
import manifest from '../package.json';
import { FormatPrettyPrint } from './ui/format-pprint';
import { JsCoqCompat } from './build/project';
import { Workspace } from './build/workspace';
import { Batch, CompileTask, BuildError } from './build/batch';
import { main as coqc } from './sdk';

// @ts-ignore
global.parcelRequire = undefined;  // bundle isolation :/

import { IcoqPod } from './backend/core';



class BatchPod extends Batch {

    icoq: IcoqPod;
    queue: any[][];

    constructor(icoq: IcoqPod) {
        super();
        this.icoq = icoq;
        this.queue = [];
        this.volume = {fs: <any>icoq.fs, path};

        this.icoq.on('message', (msg: any[]) =>
            this.queue.push(msg));
    }

    command(cmd: any[]): void {
        this.icoq.command(cmd);  // response is handled *synchronously* (?)
    }

    expect(yes: (msg: any[]) => boolean,
           no:  (msg: any[]) => boolean = this.isError): Promise<any[]> {
        while (this.queue.length > 0) {
            let msg = this.queue.shift();
            if (yes(msg))     return Promise.resolve(msg);
            else if (no(msg)) return Promise.reject(msg);
        }
    }

    

}


class IcoqPodCLI extends IcoqPod {

    pp = new FormatPrettyPrint();

    constructor() {
        super();
        this.on('message', msg => this.handleIncoming(msg));
    }

    handleIncoming(msg: any[]) {
        switch (msg[0]) {
        case 'Feedback':
            switch (msg[1].contents[0]) {
            case 'Message':
                console.log(this.pp.pp2Text(msg[1].contents[3]));     break;
            }
            break;
        case 'CoqExn':
            if (msg[1])
                console.error(`\n${msg[1].fname[1]}:${msg[1].line_nb}:`);
            console.error(this.pp.pp2Text(msg[3]));                   break;
        default:
            console.log(msg);
        }
    }

}


class CLI {

    opts: any
    workspace: Workspace

    progress: (msg: string, done?: boolean) => void
    errors = false;

    constructor(opts) {
        this.opts = opts;

        function progressTTY(msg: string, done: boolean = true) {
            process.stdout.write('\r' + msg + (done ? '\n' : ''));
        }
        function progressLog(msg: string, done: boolean = true) {
            if (done) console.log(msg);
        }
        this.progress = process.stdout.isTTY ? progressTTY : progressLog;
    }

    async prepare(opts = this.opts) {
        var workspace = new Workspace();
        if (opts.outdir)
            workspace.outDir = opts.outdir;
        if (!opts.nostdlib) {
            workspace.pkgDir = CLI.stdlibPkgDir();
            opts.loads.splice(0, 0, ...CLI.stdlibLoads());
        }
        if (!opts.compile)
            await workspace.loadDeps(opts.loads);
        if (opts.workspace)
            workspace.open(opts.workspace, opts.rootdir);
        else if (opts.rootdir)
            workspace.openProjectDirect(opts.package || path.basename(opts.rootdir),
                                        opts.rootdir, opts.top,
                                        opts.dirpaths.split(/[, ]/));
        else {
            console.error('what to build? specify either rootdir or workspace.');
            throw new BuildError();
        }
        this.workspace = workspace;
    }

    async compile(opts = this.opts) {
        var outdir = this.workspace.outDir;

        // Fire up the pod
        var icoq = new IcoqPodCLI();
        await icoq.boot();
        await icoq.loadPackages(opts.loads);
    
        for (let [pkgname, inproj] of Object.entries(this.workspace.projs)) {
            var task = new CompileTask(new BatchPod(icoq), inproj, <any>opts);

            await task.run(pkgname);
            var out = await out.toPackage(
                            opts.package || path.join(outdir, pkgname)),
                {pkg} = await out.save();
                
            this.progress(`wrote ${pkg.filename}.`, true);
        }
    }

    async package(opts = this.opts) {
        var outdir = this.workspace.outDir,
            prep  = opts.jscoq && JsCoqCompat.transpilePluginsJs,
            postp = opts.jscoq && JsCoqCompat.backportManifest;

        this.workspace.searchPath.createIndex();  // to speed up coqdep

        var bundle = this.bundle(opts),
            outfn = bundle ? undefined : opts.package;

        for (let pkgname in this.workspace.projs) {
            this.progress(`[${pkgname}] `, false);
            var p = await this.workspace.projs[pkgname]
                    .toPackage(outfn || path.join(outdir, pkgname),
                               undefined, prep, postp);
            try {
                await p.save(bundle && bundle.manifest);    
                this.progress(`wrote ${p.pkg.filename}.`, true);
            }
            catch (e) {
                this.progress(`error writing ${p.pkg.filename}:\n    ` + e);
                this.errors = true;
            }
        }

        if (bundle) {
            bundle.save();
            this.progress(`wrote ${bundle.filename}.`, true);
        }
    }

    bundle(opts = this.opts) {
        if (this.workspace.bundleName)
            return this.workspace.createBundle(path.join(this.workspace.outDir, this.workspace.bundleName));
        if (opts.package && Object.keys(this.workspace.projs).length > 1)
            return this.workspace.createBundle(opts.package);
    }

    static stdlib() {
        return require('./build/metadata/coq-pkgs.json');
    }

    static stdlibLoads() {
        return [...Object.keys(this.stdlib().projects)].map(pkg => `+${pkg}`);
    }

    static stdlibPkgDir() {
        // assumes cli is run from `dist/` directory.
        return path.join(__dirname, '../bin/coq');
    }

}



async function main() {

    var loads: string[] = [];

    /* sdk */
    if (process.argv[2] === 'coqc')
        return await coqc(process.argv.slice(3));

    var opts = commander
        .name('wacoq')
        .version(manifest.version, '-v, --version')
        .option('--workspace <w.json>',       'build projects from specified workspace')
        .option('--rootdir <dir>',            'toplevel directory for finding `.v` and `.vo` files')
        .option('--top <name>',               'logical name of toplevel directory')
        .option('--dirpaths <a.b.c>',         'logical paths containing modules (comma separated)', '')
        .option('--package <f.coq-pkg>',      'create a package (default extension is `.coq-pkg`)')
        .option('-d,--outdir <dir>',          'set default output directory')
        .option('--load <f.coq-pkg>',         'load package(s) for compilation and for module dependencies (comma separated, may repeat)')
        .option('--compile',                  'compile `.v` files to `.vo`')
        .option('--continue',                 'pick up from previous build')
        .option('--nostdlib',                 'skip loading the standard Coq packages')
        .option('--jscoq',                    'jsCoq compatibility mode')
        .on('option:load', pkg => loads.push(...pkg.split(',')))
        .parse(process.argv);

    if (opts.args[0] === 'build') opts.args.shift();

    if (opts.args.length > 0) {
        if (!opts.workspace && opts.args[0].endsWith('.json'))
            opts.workspace = opts.args.shift();
        else if (!opts.rootdir)
            opts.rootdir = opts.args.shift();

        if (opts.args.length > 0) {
            console.error('extraneous arguments: ', opts.args);
            return 1;
        }
    }

    opts.loads = loads;

    var cli = new CLI(opts);

    try {
        await cli.prepare();
        if (opts.compile)
            await cli.compile();
        else
            await cli.package();

        return cli.errors ? 1 : 0;
    }
    catch (e) {
        if (e instanceof BuildError) return 1;
        else throw e;
    }
}



main().then(rc => process.exit(rc || 0));