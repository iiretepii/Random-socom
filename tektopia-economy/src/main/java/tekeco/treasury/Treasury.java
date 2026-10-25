package tekeco.treasury;

import net.minecraft.nbt.NBTTagCompound;

/** One village's emerald balance and the totals from its most recent payday. */
public class Treasury {
    private int balance;

    private long statsDay = -1L;
    private int wagesPaid;
    private int upkeepCollected;
    private int villagersPaid;
    private int villagersUnpaid;
    private int villagersBroke;

    public int getBalance() {
        return balance;
    }

    public void deposit(int amount) {
        if (amount > 0) {
            balance += amount;
        }
    }

    /** Removes {@code amount} if the treasury holds that much; otherwise leaves it unchanged. */
    public boolean withdraw(int amount) {
        if (amount <= 0) {
            return true;
        }
        if (balance < amount) {
            return false;
        }
        balance -= amount;
        return true;
    }

    /** Starts a fresh set of payday totals the first time a villager is settled on {@code day}. */
    public void beginDay(long day) {
        if (statsDay != day) {
            statsDay = day;
            wagesPaid = 0;
            upkeepCollected = 0;
            villagersPaid = 0;
            villagersUnpaid = 0;
            villagersBroke = 0;
        }
    }

    public void recordPaid(int wage) {
        wagesPaid += wage;
        villagersPaid++;
    }

    public void recordUnpaid() {
        villagersUnpaid++;
    }

    public void recordUpkeep(int amount) {
        upkeepCollected += amount;
    }

    public void recordBroke() {
        villagersBroke++;
    }

    public long getStatsDay() {
        return statsDay;
    }

    public int getWagesPaid() {
        return wagesPaid;
    }

    public int getUpkeepCollected() {
        return upkeepCollected;
    }

    public int getVillagersPaid() {
        return villagersPaid;
    }

    public int getVillagersUnpaid() {
        return villagersUnpaid;
    }

    public int getVillagersBroke() {
        return villagersBroke;
    }

    void readFromNBT(NBTTagCompound tag) {
        balance = tag.getInteger("balance");
        statsDay = tag.hasKey("statsDay") ? tag.getLong("statsDay") : -1L;
        wagesPaid = tag.getInteger("wagesPaid");
        upkeepCollected = tag.getInteger("upkeepCollected");
        villagersPaid = tag.getInteger("villagersPaid");
        villagersUnpaid = tag.getInteger("villagersUnpaid");
        villagersBroke = tag.getInteger("villagersBroke");
    }

    void writeToNBT(NBTTagCompound tag) {
        tag.setInteger("balance", balance);
        tag.setLong("statsDay", statsDay);
        tag.setInteger("wagesPaid", wagesPaid);
        tag.setInteger("upkeepCollected", upkeepCollected);
        tag.setInteger("villagersPaid", villagersPaid);
        tag.setInteger("villagersUnpaid", villagersUnpaid);
        tag.setInteger("villagersBroke", villagersBroke);
    }
}
