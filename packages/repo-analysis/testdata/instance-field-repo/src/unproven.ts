export class UnprovenService {
  private readonly client = makeClient();

  run(): void {
    this.client.call();
  }
}
