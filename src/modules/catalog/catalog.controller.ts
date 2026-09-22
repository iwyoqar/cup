import { Controller, Get, Post } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post('sync')
  sync() {
    return this.catalogService.sync();
  }

  @Get('categories')
  categories() {
    return this.catalogService.listCategories();
  }

  @Get('products')
  products() {
    return this.catalogService.listProducts();
  }
}
