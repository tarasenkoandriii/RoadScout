import { Body, Controller, Get, Module, Post, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AdminGuard } from '../auth/admin.guard';

class CreateProviderDto {
  @IsString()
  name!: string;

  @IsString()
  baseUrl!: string;

  @IsString()
  adapterKey!: string;
}

@Controller('admin/providers')
@UseGuards(AdminGuard)
class ProvidersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.cameraProvider.findMany({ orderBy: { name: 'asc' } });
  }

  @Post()
  create(@Body() dto: CreateProviderDto) {
    return this.prisma.cameraProvider.create({ data: dto });
  }
}

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ProvidersController],
})
export class ProvidersModule {}
