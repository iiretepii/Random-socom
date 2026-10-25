package tekeco.payroll;

import net.minecraft.world.World;
import net.tangotek.tektopia.ProfessionType;
import net.tangotek.tektopia.Village;
import net.tangotek.tektopia.entities.EntityVillagerTek;
import tekeco.EcoConfig;
import tekeco.treasury.Treasury;
import tekeco.treasury.TreasuryData;
import tekeco.wallet.IWallet;
import tekeco.wallet.WalletCapability;

/**
 * Settles each loaded villager once per Minecraft day: the treasury pays their wage,
 * then they pay rent and food back to the treasury.
 *
 * Each wallet remembers the last day it was settled, so a villager in an unloaded chunk
 * is settled when it loads again, and changing the time with /time doesn't pay anyone twice.
 * Missed days are not back-paid.
 */
public final class Payroll {
    public static final long DAY_TICKS = 24000L;

    /** How often (in ticks) loaded villagers are checked. */
    public static final int CHECK_INTERVAL = 100;

    private Payroll() {
    }

    /** The current payday number: it goes up by one each day at {@link EcoConfig#paydayTime}. */
    public static long payday(World world) {
        return Math.floorDiv(world.getWorldTime() - EcoConfig.paydayTime, DAY_TICKS);
    }

    public static void run(World world) {
        long today = payday(world);
        boolean changed = false;
        for (EntityVillagerTek villager : world.getEntities(EntityVillagerTek.class, v -> v != null && v.isEntityAlive())) {
            changed |= settle(world, villager, today);
        }
        if (changed) {
            TreasuryData.get(world).markDirty();
        }
    }

    /** Returns true if any treasury changed. */
    static boolean settle(World world, EntityVillagerTek villager, long today) {
        IWallet wallet = WalletCapability.get(villager);
        if (wallet == null) {
            return false;
        }
        if (wallet.isNew() || wallet.getLastPaidDay() > today) {
            // New hire, or the clock was set back: start counting from today.
            wallet.setLastPaidDay(today);
            return false;
        }
        if (wallet.getLastPaidDay() == today) {
            return false;
        }

        ProfessionType profession = villager.getProfessionType();
        if (EcoConfig.baseWage(profession) <= 0 || !villager.hasVillage()) {
            // Children, nitwits, nomads, vendors and villagers without a village aren't on payroll.
            wallet.setLastPaidDay(today);
            return false;
        }

        Village village = villager.getVillage();
        Treasury treasury = Villages.treasury(world, village);
        if (treasury == null) {
            // No Town Hall yet: wait until there is one rather than skipping the day.
            return false;
        }

        treasury.beginDay(today);
        wallet.setLastPaidDay(today);

        int wage = EcoConfig.wage(profession, villager.getSkill(profession));
        if (treasury.withdraw(wage)) {
            wallet.add(wage);
            wallet.setLastWage(wage);
            treasury.recordPaid(wage);
        } else {
            wallet.setLastWage(0);
            treasury.recordUnpaid();
            villager.modifyHappy(-EcoConfig.unpaidPenalty);
        }

        int upkeep = EcoConfig.rent + EcoConfig.foodCost;
        if (wallet.take(upkeep)) {
            treasury.deposit(upkeep);
            treasury.recordUpkeep(upkeep);
            if (EcoConfig.comfortBonus > 0 && wallet.getCoins() >= EcoConfig.comfortSavings) {
                villager.modifyHappy(EcoConfig.comfortBonus);
            }
        } else {
            treasury.recordBroke();
            villager.modifyHappy(-EcoConfig.brokePenalty);
        }
        return true;
    }
}
