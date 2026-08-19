import { config } from "./lib/unrelated";
import { client } from "./lib/does-not-exist";

void config.url;
client.verify();
