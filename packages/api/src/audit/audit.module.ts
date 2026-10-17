import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/** F0.2 audit trail: append-only, tenant-aware, SQLite quando REVRA_DB è attivo.
 *  Il middleware è registrato da configureRevraApp (app.setup.ts): nessuna DI. */
@Module({
  controllers: [AuditController],
  providers: [
    {
      provide: AuditService,
      useFactory: () => {
        const service = new AuditService();
        service.bindDatabase(process.env.REVRA_DB);
        return service;
      },
    },
  ],
})
export class AuditModule {}
