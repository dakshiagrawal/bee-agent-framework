import { BaseMessage } from "@/llms/primitives/message.js";
import { BAMLLM } from "@/adapters/bam/llm.js";
import { BAMChatLLM } from "@/adapters/bam/chat.js";

{
  console.info("===RAW===");
  const llm = new BAMLLM({
    modelId: "google/flan-ul2",
  });

  console.info("Meta", await llm.meta());

  const response = await llm.generate("Hello world!", {
    stream: true,
  });
  console.info(response.finalResult);
}

{
  console.info("===CHAT===");
  const llm = BAMChatLLM.fromPreset("meta-llama/llama-3-1-70b-instruct");

  console.info("Meta", await llm.meta());

  const response = await llm.generate([
    BaseMessage.of({
      role: "user",
      text: "Hello world!",
    }),
  ]);
  console.info(response.messages);
}
