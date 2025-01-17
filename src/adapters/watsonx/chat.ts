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

import { AsyncStream, GenerateCallbacks } from "@/llms/base.js";
import {
  WatsonXLLM,
  WatsonXLLMGenerateOptions,
  WatsonXLLMParameters,
  WatsonXLLMOutput,
} from "@/adapters/watsonx/llm.js";
import { ChatLLM, ChatLLMOutput } from "@/llms/chat.js";
import { BaseMessage, Role } from "@/llms/primitives/message.js";
import { PromptTemplate } from "@/template.js";
import { Cache } from "@/cache/decoratorCache.js";
import { transformAsyncIterable } from "@/internals/helpers/stream.js";
import { shallowCopy } from "@/serializer/utils.js";
import { Emitter } from "@/emitter/emitter.js";
import { GetRunContext } from "@/context.js";

export class WatsonXChatLLMOutput extends ChatLLMOutput {
  public readonly raw: WatsonXLLMOutput;

  constructor(rawOutput: WatsonXLLMOutput) {
    super();
    this.raw = rawOutput;
  }

  @Cache()
  get messages(): BaseMessage[] {
    const text = this.raw.getTextContent();
    return [
      BaseMessage.of({
        role: Role.ASSISTANT,
        text,
        meta: this.raw.meta,
      }),
    ];
  }

  merge(other: WatsonXChatLLMOutput): void {
    Cache.getInstance(this, "messages").clear();
    this.raw.merge(other.raw);
  }

  getTextContent(): string {
    const [message] = this.messages;
    return message.text;
  }

  toString(): string {
    return this.getTextContent();
  }

  createSnapshot() {
    return {
      raw: shallowCopy(this.raw),
    };
  }

  loadSnapshot(snapshot: ReturnType<typeof this.createSnapshot>) {
    Object.assign(this, snapshot);
  }
}

export interface WatsonXChatLLMInputConfig {
  messagesToPrompt: PromptTemplate<"messages"> | ((messages: BaseMessage[]) => string);
}

export interface WatsonXChatLLMInput {
  llm: WatsonXLLM;
  config: WatsonXChatLLMInputConfig;
}

export class WatsonXChatLLM extends ChatLLM<WatsonXChatLLMOutput, WatsonXLLMParameters> {
  public readonly emitter = Emitter.root.child<GenerateCallbacks>({
    namespace: ["watsonx", "chat_llm"],
    creator: this,
  });

  public readonly llm: WatsonXLLM;
  protected readonly config: WatsonXChatLLMInputConfig;
  public readonly parameters: WatsonXLLMParameters;

  constructor({ llm, config }: WatsonXChatLLMInput) {
    super(llm.modelId, llm.executionOptions);
    this.parameters = llm.parameters ?? {};
    this.llm = llm;
    this.config = config;
  }

  static {
    this.register();
  }

  async meta() {
    return this.llm.meta();
  }

  createSnapshot() {
    return {
      ...super.createSnapshot(),
      modelId: this.modelId,
      parameters: this.parameters,
      executionOptions: this.executionOptions,
      llm: this.llm,
      config: shallowCopy(this.config),
    };
  }

  loadSnapshot(data: ReturnType<typeof this.createSnapshot>): void {
    super.loadSnapshot(data);
  }

  async tokenize(messages: BaseMessage[]) {
    const prompt = this.messagesToPrompt(messages);
    return this.llm.tokenize(prompt);
  }

  protected async _generate(
    messages: BaseMessage[],
    options: WatsonXLLMGenerateOptions,
    run: GetRunContext<this>,
  ): Promise<WatsonXChatLLMOutput> {
    const prompt = this.messagesToPrompt(messages);
    // @ts-expect-error protected property
    const rawResponse = await this.llm._generate(prompt, options, run);
    return new WatsonXChatLLMOutput(rawResponse);
  }

  protected async *_stream(
    messages: BaseMessage[],
    options: WatsonXLLMGenerateOptions,
    run: GetRunContext<this>,
  ): AsyncStream<WatsonXChatLLMOutput, void> {
    const prompt = this.messagesToPrompt(messages);
    // @ts-expect-error protected property
    const response = this.llm._stream(prompt, options, run);
    return yield* transformAsyncIterable(response, (output) => new WatsonXChatLLMOutput(output));
  }

  messagesToPrompt(messages: BaseMessage[]) {
    const convertor = this.config.messagesToPrompt;
    if (convertor instanceof PromptTemplate) {
      return convertor.render({ messages });
    }
    return convertor(messages);
  }
}
