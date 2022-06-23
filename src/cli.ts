// Build with
//  parcel watch --target node src/cli.ts

import fs from 'fs';
import path from 'path';
import commander from 'commander';
import manifest from '../package.json';
import { FormatPrettyPrint } from './ui/format-pprint';
import { JsCoqCompat } from './build/project';
import { Workspace } from './build/workspace';
import { Batch, CompileTask, BuildError, AnalyzeTask } from './build/batch';
import * as sdk from './sdk';

import { IcoqPod } from './backend/core';



class IcoqPodBatch extends Batch {

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
        // not found
        return Promise.reject({reason: 'expected response not found'});
    }

}


class IcoqPodCLI extends IcoqPod {

    pp = new FormatPrettyPrint()
    verbose = true

    constructor() {
        super();
        this.on('message', msg => this.handleIncoming(msg));
    }

    async startBatch(opts: any = {}) {
        await this.boot();
        if (opts.loads)
            await this.loadPackages(opts.loads);

        var batch = new IcoqPodBatch(this);
        await batch.do(
            ['Init', {}],
            ['NewDoc', {}],   msg => msg[0] === 'Ready'
        );
        return batch;
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
            if (this.verbose) console.log(msg);
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
            workspace.open(opts.workspace, opts.rootdir, opts);
        else if (opts.rootdir) {
            var dirpaths = opts.dirpaths.split(/[, ]/) as any[];
            if (!opts.recurse)
                dirpaths = dirpaths.map(d => ({logical: d, rec: false}));
            workspace.openProjectDirect(opts.package || path.basename(opts.rootdir),
                                        opts.rootdir, opts.top, dirpaths);
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
            var task = new CompileTask(new IcoqPodBatch(icoq), inproj, <any>opts);

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

    async inspect(pkgNames: string[], opts = this.opts) {
        var icoq = new IcoqPodCLI();
        icoq.verbose = false;

        var analyze = new AnalyzeTask(await icoq.startBatch(opts)),
            symb = await analyze.inspectSymbolsOfModules(
                this.listModuleNames(pkgNames));

        for (let [pkg, lemmas] of Object.entries(symb)) {
            var outfn = `${pkg.replace(/\.coq-pkg$/, '')}.symb.json`;
            if (opts.outdir)
                outfn = path.join(opts.outdir, path.basename(outfn));
            fs.writeFileSync(outfn, JSON.stringify({lemmas}));
            console.log(`wrote ${outfn}.   { lemmas: ${lemmas.length} }`);
        }
    }

    listModuleNames(pkgNames: string[]) {
        var pkgs = this.workspace.listPackageContents(new RegExp(pkgNames.join('|')));
    
        return Object.fromEntries(Object.entries(pkgs).map(([k, v]) =>
            [k, v.map(mod => mod.logical.join('.'))]
        ));
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

    var loads: string[] = [],
        rc = 0;

    var prog = commander
        .name('wacoq')
        .version(manifest.version);
    prog.command('build', {isDefault: true})
        .option('--workspace <w.json>',       'build projects from specified workspace')
        .option('--rootdir <dir>',            'toplevel directory for finding `.v` and `.vo` files')
        .option('--top <name>',               'logical name of toplevel directory')
        .option('--dirpaths <a.b.c>',         'logical paths containing modules (comma separated)', '')
        .option('--no-recurse',               'do not process subdirectories recursively')
        .option('--package <f.coq-pkg>',      'create a package (default extension is `.coq-pkg`)')
        .option('-d,--outdir <dir>',          'set default output directory')
        .option('--ignore-missing',           'skip missing projects in workspace, unless they are all missing')
        .option('--load <f.coq-pkg>',         'load package(s) for compilation and for module dependencies (comma separated, may repeat)')
        .option('--compile',                  'compile `.v` files to `.vo`')
        .option('--continue',                 'pick up from previous build')
        .option('--nostdlib',                 'skip loading the standard Coq packages')
        .option('--jscoq',                    'jsCoq compatibility mode')
        .on('option:load', pkg => loads.push(...pkg.split(',')))
        .action(async opts => { rc = await build({...opts, loads}); });
    
    prog.command('inspect')
        .option('--load <f.coq-pkg>',         'load package(s) for compilation and for module dependencies (comma separated, may repeat)')
        .option('-d,--outdir <dir>',          'set output directory')
        .on('option:load', pkg => loads.push(...pkg.split(',')))
        .action(async opts => { rc = await inspect({...opts, loads}); });

    sdk.installCommand(prog);

    await prog.parseAsync(process.argv);
    return rc;
}


async function build(opts: any) {
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

    var cli = new CLI(opts);

    try {
        await cli.prepare();
        if (Object.keys(cli.workspace.projs).length === 0) {
            console.error('what to build? specify either rootdir or workspace.');
            throw new BuildError();
        }

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

async function inspect(opts: any) {
    var cli = new CLI(opts);

    try {
        await cli.prepare();
        await cli.inspect(opts.args, opts);

        return cli.errors ? 1 : 0;
    }
    catch (e) {
        if (e instanceof BuildError) return 1;
        else throw e;
    }
}



main().then(rc => process.exit(rc || 0));