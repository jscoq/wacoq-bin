import { EventEmitter } from 'events';
import unzip from 'jszip-unzip';


class PackageDirectory extends EventEmitter {
    dir: string

    constructor(dir: string) {
        super();
        this.dir = dir;
    }

    async loadPackages(uris: string | string[]) {
        if (!Array.isArray(uris)) uris = [uris];
        for (let uri of uris) {
            await this.unzip(uri);   // not much use running async
            this.emit('message', {data: ['LibProgress', {uri, done: true}]});
        }
        this.emit('message', {data: ['LoadedPkg', uris]});
    }

    async unzip(uri: string) {
        var data = await (await fetch(uri)).arrayBuffer();
        return unzip(data, {to: {directory: this.dir}});
    }
}


export { PackageDirectory }