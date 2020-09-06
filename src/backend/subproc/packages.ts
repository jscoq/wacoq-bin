import unzip from 'jszip-unzip';


class PackageDirectory {
    dir: string

    constructor(dir: string) {
        this.dir = dir;
    }

    async loadPackages(uris: string | string[]) {
        if (!Array.isArray(uris)) uris = [uris];
        for (let uri of uris)
            await this.unzip(uri);   // not much use running async
        return uris;
    }

    async unzip(uri: string) {
        var data = await (await fetch(uri)).arrayBuffer();
        return unzip(data, {to: {directory: this.dir}});
    }
}


export { PackageDirectory }