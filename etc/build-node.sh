#!/bin/bash
parcel build --target node src/cli.ts
parcel build --target node src/backend/subproc/index.ts -o dist/subproc.js