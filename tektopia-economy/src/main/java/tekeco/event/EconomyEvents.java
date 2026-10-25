package tekeco.event;

import java.util.List;
import net.minecraft.entity.Entity;
import net.minecraft.entity.player.EntityPlayer;
import net.minecraft.util.EnumActionResult;
import net.minecraft.util.EnumHand;
import net.minecraft.util.text.TextComponentTranslation;
import net.minecraft.world.World;
import net.minecraftforge.event.AttachCapabilitiesEvent;
import net.minecraftforge.event.entity.EntityJoinWorldEvent;
import net.minecraftforge.event.entity.living.LivingDeathEvent;
import net.minecraftforge.event.entity.player.PlayerInteractEvent;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;
import net.tangotek.tektopia.entities.EntityVillagerTek;
import tekeco.EcoConfig;
import tekeco.payroll.Payroll;
import tekeco.payroll.Villages;
import tekeco.treasury.Treasury;
import tekeco.treasury.TreasuryData;
import tekeco.wallet.IWallet;
import tekeco.wallet.WalletCapability;

public class EconomyEvents {

    @SubscribeEvent
    public void attachWallet(AttachCapabilitiesEvent<Entity> event) {
        if (event.getObject() instanceof EntityVillagerTek) {
            event.addCapability(WalletCapability.KEY, new WalletCapability.Provider());
        }
    }

    @SubscribeEvent
    public void worldTick(TickEvent.WorldTickEvent event) {
        World world = event.world;
        if (event.phase == TickEvent.Phase.END && !world.isRemote && world.getTotalWorldTime() % Payroll.CHECK_INTERVAL == 0) {
            Payroll.run(world);
        }
    }

    /**
     * TekTopia replaces the villager entity when it changes profession or a child grows up:
     * the new entity copies the old one's name and stats, then the old one is set dead in the
     * same tick. Carry the wallet over so savings aren't lost.
     */
    @SubscribeEvent
    public void villagerJoined(EntityJoinWorldEvent event) {
        if (event.getWorld().isRemote || !(event.getEntity() instanceof EntityVillagerTek)) {
            return;
        }
        EntityVillagerTek joined = (EntityVillagerTek) event.getEntity();
        IWallet wallet = WalletCapability.get(joined);
        if (wallet == null || !wallet.isNew() || !joined.hasCustomName()) {
            return;
        }
        String name = joined.getCustomNameTag();
        List<EntityVillagerTek> replaced = event.getWorld().getEntitiesWithinAABB(
            EntityVillagerTek.class,
            joined.getEntityBoundingBox().grow(1.0),
            v -> v != null && v != joined && v.isDead && name.equals(v.getCustomNameTag())
        );
        for (EntityVillagerTek old : replaced) {
            IWallet oldWallet = WalletCapability.get(old);
            if (oldWallet != null && !oldWallet.isNew()) {
                wallet.copyFrom(oldWallet);
                oldWallet.setCoins(0);
                return;
            }
        }
    }

    @SubscribeEvent
    public void villagerDied(LivingDeathEvent event) {
        if (!EcoConfig.estateToTreasury || event.getEntityLiving().world.isRemote || !(event.getEntityLiving() instanceof EntityVillagerTek)) {
            return;
        }
        EntityVillagerTek villager = (EntityVillagerTek) event.getEntityLiving();
        IWallet wallet = WalletCapability.get(villager);
        if (wallet == null || wallet.getCoins() <= 0 || !villager.hasVillage()) {
            return;
        }
        Treasury treasury = Villages.treasury(villager.world, villager.getVillage());
        if (treasury != null) {
            treasury.deposit(wallet.getCoins());
            wallet.setCoins(0);
            TreasuryData.get(villager.world).markDirty();
        }
    }

    /** Sneak + right-click a villager with an empty hand to see their wallet. */
    @SubscribeEvent
    public void inspectVillager(PlayerInteractEvent.EntityInteract event) {
        if (!(event.getTarget() instanceof EntityVillagerTek) || event.getHand() != EnumHand.MAIN_HAND) {
            return;
        }
        EntityPlayer player = event.getEntityPlayer();
        if (!player.isSneaking() || !player.getHeldItemMainhand().isEmpty()) {
            return;
        }
        // Cancel on both sides so TekTopia's villager screen doesn't open.
        event.setCanceled(true);
        event.setCancellationResult(EnumActionResult.SUCCESS);
        if (event.getWorld().isRemote) {
            return;
        }

        EntityVillagerTek villager = (EntityVillagerTek) event.getTarget();
        IWallet wallet = WalletCapability.get(villager);
        if (wallet == null) {
            return;
        }
        if (EcoConfig.baseWage(villager.getProfessionType()) <= 0) {
            player.sendMessage(new TextComponentTranslation("tekeco.wallet.unpaid", villager.getDisplayName(), wallet.getCoins()));
        } else {
            player.sendMessage(new TextComponentTranslation("tekeco.wallet.info", villager.getDisplayName(), wallet.getCoins(), wallet.getLastWage()));
        }
    }
}
