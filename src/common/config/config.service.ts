import { Injectable } from '@nestjs/common';
import { Env, parseEnv } from './env.schema';

@Injectable()
export class ConfigService {
  readonly env: Env;

  constructor() {
    this.env = parseEnv(process.env);
  }
}
