// parcel watch --hmr-hostname=localhost --public-url '.' src/index.html &



function main() {
    var worker = new Worker('./worker.ts');

    const consl = document.getElementById('console'),
          prompt = document.getElementById('prompt') as HTMLInputElement,
          progress = {};

    function sendCommand(cmd) {
        worker.postMessage(JSON.stringify(cmd));
    }

    function print(text) {
        var p = document.createElement('div');
        p.innerText = text;
        consl.insertBefore(p, prompt);
        return p;
    }

    worker.addEventListener('message', (ev) => {
        console.log(ev.data);

        switch (ev.data[0]) {
        case 'Boot':
            sendCommand(['Init']); break;
        case 'Added':
            sendCommand(["Goals", ev.data[1]]); break;
        case 'GoalInfo':
        case 'Feedback':
        case 'CoqExn':
            if (ev.data[1]) print(ev.data[1]);
            break;
        case 'Progress':
            var e = ev.data[1];
            if (e.content.uri) {
                if (e.done) {
                    if (e = progress[e.content.uri]) e.remove();
                }
                else
                    progress[e.content.uri] = print(`Downloading ${e.content.uri}...`);
            }
        }
    });
    
    prompt.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            sendCommand(["Add", prompt.value]);
            prompt.value = '';
        }
    });

    Object.assign(window, {worker});
}



Object.assign(window, {main});
