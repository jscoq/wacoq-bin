import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import unzip from 'fflate-unzip';
import * as find from 'find';


class PackageDirectory extends EventEmitter {
    dir: string
    _plugins: Promise<void>

    constructor(dir: string) {
        super();
        this.dir = dir;
    }

    async loadPackages(uris: string | string[]) {
        await this._plugins;
        if (!Array.isArray(uris)) uris = [uris];
        for (let uri of uris) {
            try {
                await this.unzip(uri);   // not much use running async
                this.emit('message', {data: ['LibProgress', {uri, done: true}]});
            }
            catch (e) {
                this.emit('message', {data: ['LibError', uri, '' + e]});                
            }
        }
        this.emit('message', {data: ['LoadedPkg', uris]});
    }

    async unzip(uri: string) {
        var data = await (await fetch(uri)).arrayBuffer();
        return unzip(data, {to: {directory: this.dir}});
    }

    appropriatePlugins(binDir: string) {
        var fromDir = path.join(binDir, 'coqlib', 'plugins');
        fs.mkdirSync(this.dir, {recursive: true});
        return this._plugins = new Promise((resolve, reject) =>
            find.eachfile(/\.cmxs$/, fromDir, (filename) => {
                try {
                    this.ln_sf(filename,
                        path.join(this.dir, path.basename(filename)));
                }
                catch (e) { 
                    this.emit('message', {data: ['LibError', '<native>', '' + e]});
                }
            })
            .end(resolve));
    }

    ln_sf(target: string, source: string) {
        try { fs.unlinkSync(source); }
        catch { }
        fs.symlinkSync(target, source);
    }
}


export { PackageDirectory }