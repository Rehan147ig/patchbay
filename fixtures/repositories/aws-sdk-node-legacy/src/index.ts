import { createAwsClients } from "./aws-clients";

export const awsWorkersService = {
  clients: createAwsClients(),
};
