/**
 * Copyright 2024 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { PathLike } from "fs";
import * as crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import fs, { createReadStream } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { Cache } from "@/cache/decoratorCache.js";
import { Serializable } from "@/internals/serializable.js";
import { shallowCopy } from "@/serializer/utils.js";

export interface PythonFile {
  hash: string;
  filename: string;
}

export abstract class PythonStorage extends Serializable {
  /**
   * List all files that code interpreter can use.
   */
  abstract list(): Promise<PythonFile[]>;

  /**
   * Prepare subset of available files to code interpreter.
   */
  abstract upload(files: PythonFile[]): Promise<void>;

  /**
   * Process updated/modified/deleted files from code interpreter response.
   */
  abstract download(files: PythonFile[]): Promise<void>;
}

export class TemporaryStorage extends PythonStorage {
  protected files: PythonFile[] = [];

  async list() {
    return this.files.slice();
  }

  async upload() {}

  async download(files: PythonFile[]) {
    this.files = [
      ...this.files.filter((file) => files.every((f) => f.filename !== file.filename)),
      ...files,
    ];
  }

  createSnapshot() {
    return { files: this.files.slice() };
  }

  loadSnapshot(snapshot: ReturnType<typeof this.createSnapshot>) {
    Object.assign(this, snapshot);
  }
}

export class LocalPythonStorage extends PythonStorage {
  constructor(
    protected readonly input: {
      localWorkingDir: PathLike;
      interpreterWorkingDir: PathLike;
    },
  ) {
    super();
  }

  @Cache()
  protected async init() {
    await fs.promises.mkdir(this.input.localWorkingDir, { recursive: true });
    await fs.promises.mkdir(this.input.interpreterWorkingDir, { recursive: true });
  }

  async list(): Promise<PythonFile[]> {
    await this.init();

    const files = await fs.promises.readdir(this.input.localWorkingDir, {
      withFileTypes: true,
      recursive: false,
    });
    return Promise.all(
      files
        .filter((file) => file.isFile())
        .map(async (file) => ({
          filename: file.name,
          hash: await this.computeHash(path.join(this.input.localWorkingDir.toString(), file.name)),
        })),
    );
  }

  async upload(files: PythonFile[]): Promise<void> {
    await this.init();

    await Promise.all(
      files.map((file) =>
        copyFile(
          path.join(this.input.localWorkingDir.toString(), file.filename),
          path.join(this.input.interpreterWorkingDir.toString(), file.hash),
        ),
      ),
    );
  }

  async download(files: PythonFile[]) {
    await this.init();

    await Promise.all(
      files.map((file) =>
        copyFile(
          path.join(this.input.interpreterWorkingDir.toString(), file.hash),
          path.join(this.input.localWorkingDir.toString(), file.filename),
        ),
      ),
    );
  }

  protected async computeHash(file: PathLike) {
    const hash = crypto.createHash("sha256");
    await pipeline(createReadStream(file), hash);
    return hash.digest("hex");
  }

  createSnapshot() {
    return { input: shallowCopy(this.input) };
  }

  loadSnapshot(snapshot: ReturnType<typeof this.createSnapshot>) {
    Object.assign(this, snapshot);
  }
}