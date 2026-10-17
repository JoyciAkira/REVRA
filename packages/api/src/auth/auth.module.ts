import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { JwtAuthService } from './auth.service.js';

/** F0.2 auth: emissione token. Il enforcement è in configureRevraApp (middleware). */
@Module({
  controllers: [AuthController],
  providers: [JwtAuthService],
  exports: [JwtAuthService],
})
export class AuthModule {}
