import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BranchModule } from '../branches/branch.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { OrdersModule } from '../orders/orders.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { CartController } from './cart.controller';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';

// Checkout reuses OrdersService entirely (see cart.service.ts) rather than talking to
// PosterService directly — CartModule imports OrdersModule for exactly that one dependency.
// No cycle: OrdersModule imports PosterModule/CatalogModule/CustomersModule, none of which
// import CartModule or OrdersModule back.
//
// CustomersModule is imported directly (not just transitively via AuthModule/OrdersModule)
// because CartController uses @UseGuards(AuthGuard): Nest resolves a guard-by-class-reference's
// OWN constructor dependencies (AuthGuard needs SessionService + CustomersRepository) against
// the REQUESTING module's import graph, not solely the module that exported the guard class.
// AuthModule never re-exports CustomersRepository (it only privately consumes it), so without
// this, Nest fails at boot with "can't resolve dependencies of AuthGuard ... in the CartModule
// context" — found via a real application boot, not by tsc/build (this is a runtime DI-graph
// error, invisible to static type-checking).
@Module({
  imports: [AuthModule, CatalogModule, BranchModule, OrdersModule, CustomersModule, RewardsModule],
  controllers: [CartController],
  providers: [CartService, CartRepository],
  exports: [CartRepository, CartService],
})
export class CartModule {}
