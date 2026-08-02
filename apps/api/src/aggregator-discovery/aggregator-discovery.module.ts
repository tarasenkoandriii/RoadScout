import { Module } from '@nestjs/common';
import { AggregatorDiscoveryService } from './aggregator-discovery.service';
import { AggregatorDiscoveryController } from './aggregator-discovery.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';

@Module({
  imports: [PrismaModule],
  controllers: [AggregatorDiscoveryController],
  providers: [AggregatorDiscoveryService, RegistryProxyService],
})
export class AggregatorDiscoveryModule {}
