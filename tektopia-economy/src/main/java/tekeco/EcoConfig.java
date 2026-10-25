package tekeco;

import java.util.HashMap;
import java.util.Map;
import net.minecraftforge.common.config.Config;
import net.minecraftforge.common.config.ConfigManager;
import net.minecraftforge.fml.client.event.ConfigChangedEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.tangotek.tektopia.ProfessionType;

@Config(modid = TekEconomy.MODID)
public class EcoConfig {
    @Config.Comment({
        "Daily wage in emeralds for each TekTopia profession, before the skill bonus.",
        "A profession with a wage of 0 is not paid and does not pay living costs."
    })
    public static Map<String, Integer> wages = defaultWages();

    @Config.Comment("Extra wage at skill 100, as a fraction of the base wage. 0.5 means a fully skilled villager earns 1.5x.")
    @Config.RangeDouble(min = 0.0, max = 10.0)
    public static double skillBonus = 0.5;

    @Config.Comment("Emeralds each paid villager pays the treasury per day for housing.")
    @Config.RangeInt(min = 0)
    public static int rent = 1;

    @Config.Comment("Emeralds each paid villager pays the treasury per day for food.")
    @Config.RangeInt(min = 0)
    public static int foodCost = 1;

    @Config.Comment("Happiness lost when the treasury can't pay a villager's wage.")
    @Config.RangeInt(min = 0, max = 100)
    public static int unpaidPenalty = 10;

    @Config.Comment("Happiness lost when a villager can't afford their living costs.")
    @Config.RangeInt(min = 0, max = 100)
    public static int brokePenalty = 5;

    @Config.Comment("Savings (after living costs) at or above which a villager gets the comfort bonus.")
    @Config.RangeInt(min = 0)
    public static int comfortSavings = 20;

    @Config.Comment("Happiness gained each payday by a villager with comfortable savings.")
    @Config.RangeInt(min = 0, max = 100)
    public static int comfortBonus = 2;

    @Config.Comment("Time of day (0-23999) when payday happens. 0 is dawn.")
    @Config.RangeInt(min = 0, max = 23999)
    public static int paydayTime = 0;

    @Config.Comment("If true, a villager's savings go to the treasury when they die.")
    public static boolean estateToTreasury = true;

    @Config.Comment("If true, only operators can withdraw from a treasury.")
    public static boolean withdrawRequiresOp = false;

    public static int baseWage(ProfessionType profession) {
        if (profession == null) {
            return 0;
        }
        Integer wage = wages.get(profession.name);
        return wage == null ? 0 : Math.max(0, wage);
    }

    public static int wage(ProfessionType profession, int skill) {
        int base = baseWage(profession);
        return (int) Math.round(base * (1.0 + skillBonus * Math.max(0, Math.min(skill, 100)) / 100.0));
    }

    private static Map<String, Integer> defaultWages() {
        Map<String, Integer> map = new HashMap<>();
        map.put("bard", 3);
        map.put("blacksmith", 5);
        map.put("butcher", 3);
        map.put("chef", 4);
        map.put("cleric", 4);
        map.put("druid", 4);
        map.put("enchanter", 5);
        map.put("farmer", 3);
        map.put("guard", 4);
        map.put("captain", 6);
        map.put("lumberjack", 3);
        map.put("miner", 4);
        map.put("rancher", 3);
        map.put("teacher", 4);
        map.put("child", 0);
        map.put("nitwit", 0);
        map.put("nomad", 0);
        return map;
    }

    @Mod.EventBusSubscriber(modid = TekEconomy.MODID)
    public static class Sync {
        @SubscribeEvent
        public static void onConfigChanged(ConfigChangedEvent.OnConfigChangedEvent event) {
            if (event.getModID().equals(TekEconomy.MODID)) {
                ConfigManager.sync(TekEconomy.MODID, Config.Type.INSTANCE);
            }
        }
    }
}
